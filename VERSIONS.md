# Versions

| Component | Version | Checked |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | 2026-08-31 |
| `zod` | 3.25.76 | 2026-08-31 |
| OP3 API | 0.1.0 | 2026-08-31 |
| Node | >= 20 | 2026-08-31 |

zod stays on 3.x. The SDK's tool registration is built against it, and 4.x
changes the shape the SDK reads.

## 1.0.0, 2026-08-31

First release. 22 read-only tools over the OP3 API.

**Beyond wrapping the endpoints.** OP3's raw download row carries `audienceId`,
a privacy-preserving per-listener hash that none of its aggregated endpoints
expose. Counting distinct values of it over a window gives unique listeners,
new against returning, cohort retention and episode audience overlap, which is
the difference between reporting downloads and reporting people.

Also built on the raw rows: geography at four levels rather than a country
list, device breakdown across four dimensions, app share over any window rather
than OP3's fixed three months, an app benchmark indexed against OP3's global
mix, and an episode curve comparing an episode at equal age against the show's
own median.

**Found by probing the live API.** OP3's OpenAPI document declares no response
schemas, so every shape was probed rather than generated. Three of those probes
found bugs that would otherwise have shipped:

- `bots=true` is rejected with "Bad bots". The accepted value is `include`, and
  it does more than add bot rows: it also switches off OP3's deduplicating
  download calculation, so the same window returned 213 rows against 345.
- `/downloads/show/{uuid}` has no `desc` parameter. OP3 documents one on
  `/hits` only and silently ignores it here, so a `newest_first` option would
  have been a lie.
- The multi-show query rejects `showUuid=a,b` and needs a repeated key.

**A fourth thing worth knowing.** OP3 derives an episode id from the episode's
audio URL, so a host that regenerates those URLs leaves historical download rows
carrying ids absent from the feed listing. Across three shows checked, two
matched exactly and one had zero overlap. `op3_episode_curve` detects it and
explains it rather than returning silent zeros.

**Safety.** The OP3 API is read-only, so there is no write gating and no
`confirm` anywhere. What is guarded instead is cost, since the raw endpoints are
scans and an unbounded query hangs a client rather than failing it: bounded
windows, a row cap, a page cap, and a note on any result a cap cut short.

**Privacy.** `audienceId` and `hashedIpAddress` are aggregated inside the
process and never returned.

**Transport.** stdio and streamable HTTP. The HTTP transport is what makes
claude.ai possible, since claude.ai runs connectors from Anthropic's cloud and
cannot launch a local command.
