# Torsel

Torsel keeps your data in tables and shows each table the way the moment needs it, as a grid on the desk, a one-thumb entry screen at the gym, cards to browse or a chart to see where it is going. Claude builds the tables and views from a sentence, and any MCP client can read and write them.

It works offline. Every device keeps a full copy of your data and syncs with a server when one is around. After one visit the web app opens with no network, and a Chromium browser can install it. It speaks English and French, following the system's language. MIT licensed.

## How it works

A base holds tables. A field is text or long text, a number, an amount of money, a percentage, a rating, a duration, a date with or without a time, one choice or several, a check, a link to another table, a URL, an email, a phone number, images, or a formula, which is a SQLite expression over the row such as `"Poids" * (1 + "Reps" / 30.0)`. A file pasted or dropped on the app imports as a table, each column's type guessed. Each table has views:

- **Grid** shows every row, editable in place, with filters, colour rules, totals, and rows grouped by a field with subtotals.
- **Entry** adds a row, prefilled from the last row with the same key (the same exercise, the same category), with steppers on numbers.
- **List** groups rows into cards by a field.
- **Chart** draws bars or a line of an aggregate, by day, week or month, with an optional rolling average.

The assistant's thread, opened beside your table, and the MCP server share one set of tools. In the app, every change it makes applies at once and shows in the thread as a card with its own undo.

SQLite runs as WebAssembly on every device and on the server, so a formula gives the same number everywhere.

## Sharing a view

Publish to web, in a view's menu, makes a read-only link to a Grid, List or Chart, at `/v/<token>`. The server sends only what the view shows: the rows its filters keep and the fields it doesn't hide, formulas and chart figures already computed, fresh ids, and only the images the view names. The page asks search engines not to index it. Unpublish ends the link; the owner can copy it again until then.

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

The assistant is metered by what it costs, each model call at its tokens and price plus $0.01 per web search: $3.30 per account and $33 across the instance in any 24 hours, about 30 typical messages per account: `aiDailyBudget`, `aiInstanceDailyBudget` (0 lifts either), and `aiUnlimited = [ "you@example.com" ]` for the accounts that skip both.

An image field takes uploads, or a URL the server fetches once; the assistant and MCP clients add images by URL too. Each account keeps up to 1 GB of images, in the database: `storageMB` (0 lifts it). An image no row has named for 30 days is deleted.

A table can fill itself from a link (CSV, TSV, JSON, Excel, RSS, Atom) or an API, with a key in a header or the query, Bearer or Basic, following its pages by `Link` header or a next URL in the body. The server refreshes it by hand, hourly or daily, and a failed run deletes nothing. Presets read a Letterboxd RSS feed, a published Google Sheet and GitHub. The fields from the source are read only, the ones added beside them stay editable, and "Stop syncing" keeps the rows. 20 sources per account and 5,000 rows each: `sourceLimit` and `sourceRowLimit`. The keys those links need are encrypted with `TORSEL_SECRETS_KEY` from the environment file, or with `/var/lib/torsel/secrets.key`, which the server makes on first start: back it up with the database.

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

The server speaks MCP over Streamable HTTP at `/api/mcp`, statelessly, to clients on the 2026-07-28 revision and to those still on the 2025 ones. Claude Code connects by signing in, with no token to copy:

```sh
claude mcp add --transport http torsel https://your-instance/api/mcp
```

Then `/mcp` in Claude Code opens Torsel's consent page in the browser. Claude.ai, ChatGPT and the other clients that sign in take the same URL.

Torsel is its own OAuth 2.1 server. A client finds it from the endpoint's 401, which points to the protected resource metadata (RFC 9728) and the server metadata (RFC 8414). It identifies itself by the URL of its metadata document, or by registering (RFC 7591), and signs in with PKCE. The consent shows the app, where it returns and the account, and can narrow the access to read only. The client gets a one-hour token valid only on the resource it named (RFC 8707), `/api/mcp` when it names none, and a refresh token that changes at each use; a refresh token used twice ends the connection. Settings, Connected apps, lists each app with the day it was last used and revokes it. Changing the password ends every connection.

Sign-in needs `ORIGIN` on https, or on localhost; without it, tokens are the only way in. The server fetches a client's metadata document, like the links tables fill from, from public addresses only: `TORSEL_FETCH_PRIVATE=1` lets it reach loopback and private ones too, for an instance that lives on a LAN.

Scripts and clients that don't sign in use a token. Create one in Settings, Agents (MCP), then:

```sh
claude mcp add --transport http torsel https://your-instance/api/mcp \
  --header "Authorization: Bearer ts_..."
```

A token reads only, or reads and writes, and can expire after 30, 90 or 365 days. It reaches `/api/mcp` and the REST API, and nothing else. Settings lists each token with the day it was last used, and revokes it.

The 20 tools are the assistant's own, minus the four that need a screen or an attachment. Each write shows in the app as a card in a conversation named after the token, where it can be undone. A read-only token sees `list_bases`, `describe_base` and `query`. Every tool declares its input and output schemas and its annotations. Unknown keys are refused, and a refused call says what to change and writes nothing. `query` runs one SELECT in a worker thread and stops after 500 ms; a page holds up to 200 rows, and its `next` is the `offset` of the following page.

Each token makes at most 120 calls a minute (`TORSEL_MCP_CALLS_PER_MINUTE`, 0 for no cap). A browser page reaches the endpoint only from the server's own origin or one listed in `CORS_ORIGINS`.

`bun run test:e2e mcp.spec.ts` runs the MCP conformance suite against both revisions, with each scenario Torsel does not serve listed and explained in `tests/e2e/mcp-baseline-*.yml`, then Inspector's `--strict` schema check.

## REST API

`/api/v1` reads and changes the same data over plain HTTP, through the same tools: bases, a base's schema, rows (list, add, change, delete, one or many), a read-only SQL `query`, and `/api/v1/changes?base=&since=`, a feed of what changed in a base since a cursor, for polling triggers in n8n, Zapier or Make. The OpenAPI 3.1 document at `/api/v1/openapi.json` is generated from the tools' schemas and imports into Postman, Insomnia or any OpenAPI client; `/docs/api` shows it.

```sh
curl -H "Authorization: Bearer ts_..." https://your-instance/api/v1/bases/Gym/tables/Sets/rows
```

It takes a token from Settings or an OAuth access token whose resource is `https://your-instance/api/v1`, in the `Authorization` header only: the session cookie is no credential there, so any origin may call it. Each token makes at most 300 requests a minute (`TORSEL_API_CALLS_PER_MINUTE`, 0 for no cap), then gets 429 with `Retry-After`.

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
