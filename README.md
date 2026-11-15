# Torsel

Torsel keeps your data in tables and shows each table the way the moment needs it, as a grid on the desk, a one-thumb entry screen at the gym, cards to browse or a chart to see where it is going. Claude builds the tables and views from a sentence, and any MCP client can read and write them.

It works offline. Every device keeps a full copy of your data and syncs with a server when one is around. After one visit the web app opens with no network, and a Chromium browser can install it. MIT licensed.

## How it works

A base holds tables. A field is text, a number, a date, a choice, a check, a link to another table, or a formula, which is a SQLite expression over the row such as `"Poids" * (1 + "Reps" / 30.0)`. Each table has views:

- **Grid** shows every row, editable in place.
- **Entry** adds a row, prefilled from the last row with the same key (the same exercise, the same category), with steppers on numbers.
- **List** groups rows into cards by a field.
- **Chart** draws bars or a line of an aggregate, by day, week or month, with an optional rolling average.

The assistant's thread, opened beside your table, and the MCP server share one set of tools. In the app, every change it makes applies at once and shows in the thread as a card with its own undo.

SQLite runs as WebAssembly on every device and on the server, so a formula gives the same number everywhere.

## Android

There is no published APK yet. With the Android SDK and a phone over adb:

```sh
bun install
bun run app:install
```

The app starts local. Settings, Server, connects it to an instance, and its sign-in screen asks for one too. It signs in with a password or a 6-digit emailed code.

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

Or open sign-up to the public, with sign-in mail sent through [Brevo](https://www.brevo.com) and Google sign-in:

```nix
services.torsel = {
  origin = "https://torsel.example.com"; # pins emailed links and the Google redirect
  publicSignup = true;
  emailFrom = "no-reply@example.com";
  environmentFile = "/run/secrets/torsel.env"; # BREVO_API_KEY=..., GOOGLE_CLIENT_ID=..., GOOGLE_CLIENT_SECRET=...
};
```

Without a Brevo key the mail goes to the journal, code and link included. Google's redirect URI is `<origin>/api/auth/google`.

The assistant takes 30 messages per account and 300 across the instance in any 24 hours: `aiDailyLimit`, `aiInstanceDailyLimit` (0 lifts either), and `aiUnlimited = [ "you@example.com" ]` for the accounts that skip both.

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

The server speaks MCP over Streamable HTTP at `/api/mcp`, statelessly, to clients on the 2026-07-28 revision and to those still on the 2025 ones. Create a token in Settings, Agents (MCP), then:

```sh
claude mcp add --transport http torsel https://your-instance/api/mcp \
  --header "Authorization: Bearer ts_..."
```

A token reads only, or reads and writes, and can expire after 30, 90 or 365 days. It reaches `/api/mcp` and nothing else. Settings lists each token with the day it was last used, and revokes it.

The 14 tools are the assistant's own, minus the three that need a screen or an attachment. A read-only token sees `list_bases`, `describe_base` and `query`. Every tool declares its input and output schemas and its annotations. Unknown keys are refused, and a refused call says what to change and writes nothing. `query` runs one SELECT in a worker thread and stops after 500 ms; a page holds up to 200 rows, and its `next` is the `offset` of the following page.

Each token makes at most 120 calls a minute (`TORSEL_MCP_CALLS_PER_MINUTE`, 0 for no cap). A browser page reaches the endpoint only from the server's own origin or one listed in `CORS_ORIGINS`.

`bun run test:e2e mcp.spec.ts` runs the MCP conformance suite against both revisions, with each scenario Torsel does not serve listed and explained in `tests/e2e/mcp-baseline-*.yml`, then Inspector's `--strict` schema check.

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
