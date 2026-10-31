{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.torsel;

  serviceUser = "torsel";
  stateDirectory = "torsel";
  stateDir = "/var/lib/${stateDirectory}";

  loopbackHosts = [
    "127.0.0.1"
    "::1"
    "[::1]"
    "localhost"
  ];

  # DynamicUser: only the same User= and StateDirectory= reach the service's uid, so a
  # shell-run CLI would leave the database root-owned.
  accountTool = pkgs.writeShellScriptBin "torsel-account" ''
    exec ${config.systemd.package}/bin/systemd-run \
      --quiet --collect --pty --pipe \
      --property=DynamicUser=yes \
      --property=User=${serviceUser} \
      --property=StateDirectory=${stateDirectory} \
      --property=WorkingDirectory=${stateDir} \
      --setenv=DATABASE_PATH=${cfg.databasePath} \
      ${lib.getExe' cfg.package "torsel-account"} "$@"
  '';
in
{
  options.services.torsel = {
    enable = lib.mkEnableOption "Torsel";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.torsel;
      defaultText = lib.literalExpression "torsel.packages.\${system}.torsel";
      description = "The Torsel package to run.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = ''
        Address the server binds to. Keep loopback when fronted by a reverse
        proxy; see `trustedProxyHops`, which assumes one is there.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "TCP port the server listens on.";
    };

    databasePath = lib.mkOption {
      type = lib.types.str;
      default = "${stateDir}/torsel.db";
      description = ''
        Filesystem path to the SQLite database, migrated at boot. Keep it inside
        ${stateDir}, the only place the DynamicUser can write.
      '';
    };

    origin = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "http://192.168.1.50:3000";
      description = ''
        The origin this instance is reached at. Required over plain http: the
        server otherwise assumes https and marks the session cookie `Secure`,
        which browsers drop over http. Required too for emailed sign-in links and
        Google sign-in: a link or redirect is never built from the request's Host
        header, so without this an email carries its code alone and Google stays
        hidden.
      '';
    };

    trustedProxyHops = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 1;
      description = ''
        How many reverse proxies sit in front of the server; zero means it is
        reached directly. Above zero this sets adapter-node's ADDRESS_HEADER,
        XFF_DEPTH and PROTOCOL_HEADER together. Only the last
        `trustedProxyHops` entries of x-forwarded-for are believed, so leaving
        this above zero on a directly exposed instance lets callers bypass the
        login throttle.
      '';
    };

    publicSignup = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Let anyone create an account from the sign-in page, or with Google. Off,
        accounts come from `torsel-account` alone.
      '';
    };

    emailFrom = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "no-reply@example.com";
      description = ''
        Sender of the sign-in mail, on a domain verified at Brevo. With this and
        `BREVO_API_KEY` in `environmentFile` the mail goes out; without either it
        goes to the journal instead, code and link included.
      '';
    };

    emailFromName = lib.mkOption {
      type = lib.types.str;
      default = "Torsel";
      description = "Display name of the sign-in mail's sender.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/torsel.env";
      description = ''
        systemd EnvironmentFile, read at start and never copied to the Nix store.
        `ANTHROPIC_API_KEY=...` in it turns on the built-in assistant;
        `TORSEL_AI_MODEL=...` picks another Claude model; `BREVO_API_KEY=...`
        sends the sign-in mail; `GOOGLE_CLIENT_ID=...` and
        `GOOGLE_CLIENT_SECRET=...` turn on Google sign-in, with
        `<origin>/api/auth/google` as the redirect URI.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    warnings = lib.optional (cfg.trustedProxyHops > 0 && !lib.elem cfg.host loopbackHosts) ''
      services.torsel binds ${cfg.host} with trustedProxyHops = ${toString cfg.trustedProxyHops}.
      If nothing proxies this instance, the client address is whatever the caller
      puts in x-forwarded-for, and the login throttle can be bypassed at will.
      Set trustedProxyHops = 0 for a directly-exposed instance.
    '';

    environment.systemPackages = [ accountTool ];

    systemd.services.torsel = {
      description = "Torsel";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        HOST = cfg.host;
        PORT = toString cfg.port;
        NODE_ENV = "production";
        DATABASE_PATH = cfg.databasePath;
      }
      // lib.optionalAttrs (cfg.origin != "") {
        ORIGIN = cfg.origin;
      }
      // lib.optionalAttrs cfg.publicSignup {
        TORSEL_PUBLIC_SIGNUP = "1";
      }
      // lib.optionalAttrs (cfg.emailFrom != "") {
        TORSEL_EMAIL_FROM = cfg.emailFrom;
        TORSEL_EMAIL_FROM_NAME = cfg.emailFromName;
      }
      // lib.optionalAttrs (cfg.trustedProxyHops > 0) {
        ADDRESS_HEADER = "x-forwarded-for";
        XFF_DEPTH = toString cfg.trustedProxyHops;
        PROTOCOL_HEADER = "x-forwarded-proto";
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        EnvironmentFile = lib.mkIf (cfg.environmentFile != null) [ cfg.environmentFile ];

        Restart = "on-failure";
        RestartSec = "5s";

        DynamicUser = true;
        User = serviceUser;
        StateDirectory = stateDirectory;
        StateDirectoryMode = "0750";
        WorkingDirectory = stateDir;

        TasksMax = 256;

        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        ProtectProc = "invisible";
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        # V8's JIT, and the WebAssembly SQLite build, need writable+executable pages.
        MemoryDenyWriteExecute = false;
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
          "~@resources"
        ];
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];
        CapabilityBoundingSet = [ "" ];
        AmbientCapabilities = [ "" ];
        UMask = "0077";
      };
    };
  };
}
