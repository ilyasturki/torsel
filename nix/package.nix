{
  lib,
  stdenv,
  bun,
  nodejs-slim_24,
  makeWrapper,
}:

let
  # Pinned: `node:sqlite` is the database driver, so the major must not move silently.
  nodejs = nodejs-slim_24;
  packageJSON = lib.importJSON ../package.json;

  manifest = lib.fileset.unions [
    ../package.json
    ../bun.lock
  ];

  appSources = lib.fileset.difference ../src (
    lib.fileset.fileFilter (file: lib.hasInfix ".test." file.name) ../src
  );

  # `outputHash` must be refreshed whenever bun.lock or package.json change: `bun run nix:deps-hash`.
  # bun.lock must stay at lockfileVersion 1, the only format the bun in nixpkgs reads.
  deps = stdenv.mkDerivation {
    pname = "${packageJSON.name}-deps";
    inherit (packageJSON) version;

    src = lib.fileset.toSource {
      root = ../.;
      fileset = manifest;
    };

    nativeBuildInputs = [ bun ];

    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      bun install --frozen-lockfile --ignore-scripts
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -R node_modules "$out/node_modules"
      runHook postInstall
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-xRGtJ/msxVdq6+jz2wcunMUX4hsA2zoP9y7vQCB0v8c=";
  };
in
stdenv.mkDerivation {
  pname = packageJSON.name;
  inherit (packageJSON) version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      manifest
      ../tsconfig.json
      ../vite.config.ts
      appSources
      ../static
      ../drizzle
      ../scripts/account.ts
    ];
  };

  nativeBuildInputs = [
    bun
    nodejs
    makeWrapper
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${deps}/node_modules ./node_modules
    chmod -R u+w ./node_modules
    patchShebangs node_modules

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR"
    export NODE_ENV=production

    node node_modules/.bin/svelte-kit sync
    node node_modules/.bin/vite build

    # `adapter-node` externalises its dependencies, so bundling is what lets the output run
    # without a node_modules beside it. SQLite stays external: it locates its .wasm beside itself.
    bun build --target=node --outdir=build/bundled --external @sqlite.org/sqlite-wasm build/server/index.js

    bun build --target=node --outfile=account.js scripts/account.ts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/share/torsel/server" "$out/share/torsel/node_modules/@sqlite.org"
    cp -R build/bundled/. "$out/share/torsel/server/"
    cp -R build/server/client "$out/share/torsel/server/client"
    cp -R build/server/prerendered "$out/share/torsel/server/prerendered"
    cp -R node_modules/@sqlite.org/sqlite-wasm "$out/share/torsel/node_modules/@sqlite.org/sqlite-wasm"

    cp -R drizzle "$out/share/torsel/drizzle"
    cp account.js "$out/share/torsel/account.js"

    # bun emits ESM; without this Node reads both bare `.js` entry points as CommonJS.
    echo '{"type":"module"}' > "$out/share/torsel/package.json"

    makeWrapper "${nodejs}/bin/node" "$out/bin/torsel" \
      --add-flags "$out/share/torsel/server/index.js" \
      --set-default MIGRATIONS_DIR "$out/share/torsel/drizzle"

    makeWrapper "${nodejs}/bin/node" "$out/bin/torsel-account" \
      --add-flags "$out/share/torsel/account.js" \
      --set-default MIGRATIONS_DIR "$out/share/torsel/drizzle"

    runHook postInstall
  '';

  # The landing and legal pages are prerendered files the bundle serves from beside itself.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck

    HOST=127.0.0.1 PORT=4321 ORIGIN=http://127.0.0.1:4321 DATABASE_PATH="$TMPDIR/check.db" \
      "$out/bin/torsel" &
    server=$!
    answers() {
      node -e 'fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' \
        "http://127.0.0.1:4321$1"
    }
    for path in / /privacy /app /api/health; do
      tries=0
      until answers "$path"; do
        tries=$((tries + 1))
        if [ "$tries" -ge 50 ]; then
          kill "$server"
          echo "install check: $path did not answer 200" >&2
          exit 1
        fi
        sleep 0.2
      done
    done
    kill "$server"

    runHook postInstallCheck
  '';

  passthru.deps = deps;

  meta = {
    description = "Data as tables, interfaces as views";
    mainProgram = "torsel";
    platforms = [ "x86_64-linux" ];
  };
}
