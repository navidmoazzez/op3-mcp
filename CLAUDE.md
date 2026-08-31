# Working on this repo

For agents editing `op3-mcp`. Users want the README instead.

## What this is

An MCP server over the OP3 API. TypeScript, Node >= 20, ESM, stdio and
streamable HTTP. Everything is a read: OP3 has no write endpoints, so there is
no write gating, no `confirm` argument, and no read-only mode to build.

## Before changing anything

**Probe the API, do not trust the spec.** OP3's OpenAPI document at
`https://op3.dev/api/docs/swagger.json` declares no response schemas and its
parameter descriptions omit the accepted values. Three real bugs came from
believing it. `preview07ce` is OP3's documented public token, so probing costs
nothing:

```bash
curl -s -H "Authorization: Bearer preview07ce" \
  "https://op3.dev/api/1/queries/top-apps" | head -c 400
```

**Known API facts, each verified live.** Do not re-derive these, and do not
"fix" them back:

- `bots` takes `include`, never `true`. It also disables OP3's deduplicating
  download calculation, so it is not purely a bot filter.
- `/downloads/show/{uuid}` has no `desc`. Rows always come back oldest first.
- `/hits` does support `desc`.
- Multiple shows need a repeated `showUuid` key, not a comma-joined list.
- `show-download-counts` is keyed by lowercase uuid.
- `episode-download-counts` returns an empty array for shows the daily rollup
  has not covered. That is normal, not an error.
- Episode ids in download rows can differ from those in the feed listing when a
  host regenerates audio URLs.

## Layout

```
src/
  index.ts        entry, arg parsing, transport selection
  server.ts       assembly and the instructions block
  config.ts       settings from the environment, and the cost caps
  doctor.ts       what is actually broken
  api/            client, typed errors, identifier resolution, response types
  analytics/      the aggregation maths: rollup, audience, trend
  format/         time windows, redaction, injection framing
  tools/          one module per group, plus kit.ts and context.ts
  transport/      streamable HTTP
```

`analytics/` is separate from `format/` on purpose. `format/` shapes output for
a model. `analytics/` computes numbers and is where the tests concentrate,
because that is the part that can be quietly wrong.

## Rules

**Never return `audienceId` or `hashedIpAddress`.** They are aggregated inside
the process. This is the one line that must not move: OP3 exists to be
privacy-preserving, and a stable per-listener key in a transcript is a tracking
key. `format/redact.ts` is where it is enforced.

**Never report a truncated result as complete.** Any pull that hits a cap
carries a note saying so, because every rate computed from a partial window is
wrong and a caller cannot tell from the numbers.

**Prefer the rolled-up endpoints.** A tool that reads raw rows to answer
something `show-download-counts` already knows is a slow wrong answer. Tool
descriptions should point at the cheap tool.

**Tool descriptions are the interface.** A model cannot see this code. Say what
the tool reaches, what it costs, and what will surprise the caller.

## Adding a tool

1. Put it in the module for what it reaches, not what endpoint it calls.
2. Register through `register()` in `tools/kit.ts`, which applies the read
   annotations and turns a thrown error into a readable result.
3. Bump `TOOL_COUNT` in `tools/index.ts`. The CI smoke test asserts it.
4. Update the tool table in `README.md` and the routing table in `SKILL.md`.

## Tests

vitest against a faked transport. Never the network, never a real token.

```bash
npm test
npm run typecheck
npm run build
```

The client tests carry regressions for the three API bugs above. If one starts
failing, check whether OP3 changed before changing the test.

A build passing says nothing about whether the server starts and lists its
tools, which is the failure a user would actually hit, so run the handshake:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/index.js 2>/dev/null | tail -1 | head -c 200
```

## House rules

No em dashes. Short paragraphs. Comments explain why, not what.

Never name another project or maintainer as a comparison, in code or docs.

Never put AI attribution in a commit message.
