# Torsel

Torsel keeps your data in tables and shows each table the way the moment needs it, as a grid on the desk, a one-thumb entry screen at the gym, cards to browse or a chart to see where it is going. Claude builds the tables and views from a sentence, and any MCP client can read and write them.

It works offline. Every device keeps a full copy of your data and syncs with a server when one is around. MIT licensed. My instance runs at [torsel.ilyasturki.com](https://torsel.ilyasturki.com).

## How it works

A base holds tables. A field is text, a number, a date, a choice, a check, a link to another table, or a formula, which is a SQLite expression over the row such as `"Poids" * (1 + "Reps" / 30.0)`. Each table has views:

- **Grid** shows every row, editable in place.
- **Entry** adds a row, prefilled from the last row with the same key (the same exercise, the same category), with steppers on numbers.
- **List** groups rows into cards by a field.
- **Chart** draws bars or a line of an aggregate, by day, week or month, with an optional rolling average.

The assistant in the bottom bar and the MCP server share one set of tools. In the app, data it enters applies at once with an undo, a new table, field or view is proposed before it lands, and a deletion asks first.

SQLite runs as WebAssembly on every device and on the server, so a formula gives the same number everywhere.

## Android

There is no published APK yet. With the Android SDK and a phone over adb:

```sh
bun install
bun run app:install
```

The app starts local. Réglages, Serveur, connects it to an instance.

## Self-host on NixOS

```nix
# flake.nix
inputs.torsel.url = "github:ilyasturki/torsel";
# modules = [ torsel.nixosModules.default ];
```

```nix
services.torsel = {
  enable = true;
  environmentFile = "/run/secrets/torsel.env"; # ANTHROPIC_API_KEY=... turns on the assistant
};
```

The server listens on `127.0.0.1:3000` with its SQLite database in `/var/lib/torsel`, behind one reverse proxy by default (`trustedProxyHops = 1`). Create your account on the machine:

```sh
sudo torsel-account create you@example.com
```

Every option is documented in [`nix/module.nix`](nix/module.nix).

## Run without Nix

Building needs [bun](https://bun.sh), running needs Node 24.

```sh
bun install
bun run build:server
cp .env.example .env
bun run account:create you@example.com
bun run start
```

## MCP

The server speaks MCP over Streamable HTTP at `/api/mcp`. Create a token in Réglages, Agents (MCP), then:

```sh
claude mcp add --transport http torsel https://your-instance/api/mcp \
  --header "Authorization: Bearer ts_..."
```

## Development

```sh
bun install
bun run account:create dev@torsel.local
bun run dev
```

The checks: `bun run format`, `bun run lint`, `bun run check`, `bun run test`.

`bun.lock` stays at `lockfileVersion` 1, the format the bun in nixpkgs reads. After a dependency change, `bun run nix:deps-hash` refreshes the hash the Nix build checks.

## License

[MIT](LICENSE)
