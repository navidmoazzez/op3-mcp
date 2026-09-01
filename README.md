<img src="https://cdn.navid.media/connectors/op3-icon.png" alt="OP3" width="88">

# OP3 MCP

[![Stars](https://img.shields.io/github/stars/navidmoazzez/op3-mcp?style=flat&logo=github&label=Stars)](https://github.com/navidmoazzez/op3-mcp)
[![License](https://img.shields.io/badge/License-MIT-blue)](https://github.com/navidmoazzez/op3-mcp/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/@thenavidm/op3-mcp?color=orange&label=npm)](https://www.npmjs.com/package/@thenavidm/op3-mcp)
[![Downloads](https://img.shields.io/npm/dm/@thenavidm/op3-mcp?color=green&label=downloads)](https://www.npmjs.com/package/@thenavidm/op3-mcp)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)

[OP3](https://op3.dev) sits in front of the audio file, so it counts every download whatever app made it.

That is why its numbers differ from Apple's or Spotify's, which each report only their own listeners.

22 tools, including unique listeners, retention cohorts and episode benchmark curves that OP3's own API does not expose.

Built and maintained by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=op3-mcp).

```
You:  How is my podcast actually doing this month?

Claude:  213 downloads over the last 30 days, from 209 unique listeners.
         That ratio of 1.02 is unusually clean: nearly every download is a
         distinct person rather than an app re-fetching.

         Week by week: 1, 3, 101, 108. The second half of the window is
         well ahead of the first.

         Your audience is spread across 132 regions. Sao Paulo is the
         largest single one at 5.6%, then Dhaka and Punjab.

         One thing worth knowing: 96% of downloads come through Chrome,
         against 7.5% across all podcasts. That is a 12.9x over-index, and
         it means people are listening on your web page rather than in a
         podcast app.
```

## Contents

1. [What you can ask it](#1-what-you-can-ask-it-)
2. [Quick install](#2-quick-install-)
3. [Setup](#3-setup-)
4. [Connect your client](#4-connect-your-client-)
5. [Check it worked](#5-check-it-worked-)
6. [Tools](#6-tools-)
7. [Reading the numbers](#7-reading-the-numbers-)
8. [Your data](#8-your-data-)
9. [Troubleshooting](#9-troubleshooting-)

## 1. What you can ask it 💬

- How many downloads did my podcast get this month?
- How many actual people is that, not downloads?
- Are my listeners coming back, or is it a new audience every month?
- Is this week's episode tracking ahead or behind my usual?
- Where in the world is my audience, down to the state?
- Which podcast apps do my listeners use, and is that unusual?
- Compare my show against these three others.
- What day and hour do most downloads happen?
- Which of my episodes share the same listeners?
- OP3 shows nothing for my feed. What is wrong?

The one that is impossible without this server is the second. Every podcast
analytics dashboard reports downloads. A download is an app fetching a file, not
a person, and one listener whose app re-requests across three days counts three
times. OP3's raw rows carry a privacy-preserving per-listener hash, so unique
listeners, returning listeners and retention can be computed from them. None of
OP3's own aggregated endpoints expose that, and this server does.

## 2. Quick install ⚡

Node 20 or newer. Nothing else.

```bash
npx -y @thenavidm/op3-mcp@latest --version
```

That is the whole install. `npx` fetches it on demand, so there is nothing to
update later: with `@latest`, a new version reaches you the next time your
client starts the server.

To build from source instead:

```bash
git clone https://github.com/navidmoazzez/op3-mcp.git
cd op3-mcp
npm install
npm run build
npm test
node dist/index.js --version
```

## 3. Setup 🔑

**You can skip this.** The server works with no credential at all, because OP3
publishes a shared preview token and that is what it falls back to. It is rate
limited and OP3 can withdraw it, so get your own before relying on it.

### Have an agent do it

The agent cannot sign in to OP3 for you. What it can do is walk you through it
and wire up the config.

Paste this into Claude Code, Cursor, or any agent with terminal access:

```
Help me set up the OP3 MCP server.

1. Open https://op3.dev/api/keys and tell me what to click to create an
   API key and its bearer token.
2. Stop and wait for me to paste the token back.
3. Add the server to my MCP client config with that token as OP3_TOKEN.
4. Run the doctor command and tell me whether it worked.
```

### Or do it yourself

1. Go to [op3.dev/api/keys](https://op3.dev/api/keys).
2. Create an API key and copy its bearer token.
3. Set it as `OP3_TOKEN` in your client config, as in section 4.

You do not need to own a podcast. The token reads public OP3 data, which covers
every show that has the OP3 prefix on its feed.

### To revoke

Delete the key at [op3.dev/api/keys](https://op3.dev/api/keys). It stops working
immediately.

### If you want your own show in here

Your podcast needs the OP3 prefix on its episode audio URLs. That is a change to
your feed, not to this server, and it is documented at
[op3.dev/setup](https://op3.dev/setup). Until a listener downloads an episode
through the prefix, OP3 has no data for your show and neither does this.

## 4. Connect your client 🔌

`OP3_TOKEN` is optional in every block below. Leave it out to use OP3's preview
token.

### Claude Code

```bash
claude mcp add op3 \
  -e OP3_TOKEN=your-token \
  -- npx -y @thenavidm/op3-mcp@latest
```

Add `--scope user` to make it available in every project rather than just this
one.

### Claude Desktop

| Platform | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "op3": {
      "command": "npx",
      "args": ["-y", "@thenavidm/op3-mcp@latest"],
      "env": { "OP3_TOKEN": "your-token" }
    }
  }
}
```

> **Tip**
> Claude Desktop does not inherit your shell PATH. If `npx` is not found, use
> the absolute path from `which npx`.

Quit Claude Desktop completely and reopen it.

### claude.ai on the web

claude.ai runs a connector from Anthropic's cloud rather than your machine, so
it cannot launch a local command. It needs a public HTTPS URL.

Run the server over HTTP:

```bash
npx -y @thenavidm/op3-mcp@latest --http --port 8000
```

Host it somewhere with a public HTTPS URL, then in claude.ai go to
**Customize**, **Connectors**, **+**, **Add custom connector**, paste the URL
and click **Add**.

On Team and Enterprise plans an owner adds it first under **Organization
settings, Connectors**, then each member enables it under **Customize,
Connectors**.

Set `OP3_HTTP_TOKEN` to require a bearer token on every request, and
`OP3_HTTP_HOST=0.0.0.0` if it needs to accept connections from outside the
machine. It binds to `127.0.0.1` by default.

### Cursor

`.cursor/mcp.json`, same JSON shape as Claude Desktop, key `mcpServers`.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, key `mcpServers`.

### VS Code

`.vscode/mcp.json`. The key is `servers`, not `mcpServers`, and each entry takes
`"type": "stdio"`.

```json
{
  "servers": {
    "op3": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thenavidm/op3-mcp@latest"],
      "env": { "OP3_TOKEN": "your-token" }
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.op3]
command = "npx"
args = ["-y", "@thenavidm/op3-mcp@latest"]

[mcp_servers.op3.env]
OP3_TOKEN = "your-token"
```

### Gemini CLI

`~/.gemini/settings.json`, key `mcpServers`.

### Everything else

Any stdio MCP client takes the same three things: the command `npx`, the args,
and the env block.

### Docker

```bash
docker build -t op3-mcp .
docker run --rm -i -e OP3_TOKEN=your-token op3-mcp
```

## 5. Check it worked 🩺

```bash
npx -y @thenavidm/op3-mcp@latest doctor
```

It tests the token against the cheapest OP3 endpoint, tests the raw query
endpoints separately because they fail for their own reasons, and prints the
settings in force.

| Symptom | Cause |
|---|---|
| `doctor` says the token was rejected | The key was deleted at op3.dev/api/keys, or `OP3_TOKEN` has a stray space |
| Every show lookup returns not found | The podcast does not have the OP3 prefix on its feed. Run `op3_verify_prefix` |
| Rolled-up tools work, raw ones time out | The window is too wide. Narrow it, or raise `OP3_REQUEST_TIMEOUT_MS` |
| Numbers do not match the OP3 dashboard | Rolled-up figures lag by about a day. Check the `asof` field |
| `npx` not found in Claude Desktop | Desktop does not inherit your shell PATH. Use the absolute path |

## 6. Tools 🛠️

Every tool is a read. Nothing here changes anything.

### Finding a show

| Tool | Does |
|---|---|
| `op3_resolve_show` | Any identifier to an OP3 show uuid. Takes a feed URL and encodes it for you |
| `op3_get_show` | Show title, uuid, podcast guid, stats page, optionally the episode list |
| `op3_list_episodes` | Episodes with OP3 episode ids and publication dates, searchable by title |

### Downloads, from OP3's rolled-up data

Fast. Prefer these whenever they answer the question.

| Tool | Does |
|---|---|
| `op3_show_downloads` | Monthly downloads, the week-by-week breakdown, and the weekly average |
| `op3_episode_downloads` | Downloads at 1, 3, 7 and 30 days after publication, plus all-time |
| `op3_compare_shows` | Several shows ranked side by side, in one request |

### Audience, from the raw rows

The tools OP3's own API cannot give you.

| Tool | Does |
|---|---|
| `op3_audience_summary` | Unique listeners against downloads, and the ratio between them |
| `op3_new_vs_returning` | First-time against repeat listeners, over a baseline you choose |
| `op3_listener_retention` | Cohort carry-over between two periods, as two separate rates |
| `op3_episode_overlap` | Which episodes share an audience, and how much |

### Where and how

| Tool | Does |
|---|---|
| `op3_geography` | Downloads and listeners by continent, country, region, metro or timezone |
| `op3_app_share` | Podcast apps, over any window rather than OP3's fixed three months |
| `op3_device_breakdown` | All four dimensions at once: agent type, app, device type, device |
| `op3_global_app_share` | App market share across every show OP3 measures |
| `op3_benchmark_apps` | This show against that global mix, indexed so 100 is average |

### Over time

| Tool | Does |
|---|---|
| `op3_download_trend` | Downloads and listeners by day, week or month, with a growth rate |
| `op3_listening_patterns` | Hour of day and day of week, in UTC |
| `op3_episode_curve` | One episode against the show's median at the same age |

### Discovery and setup

| Tool | Does |
|---|---|
| `op3_recent_transcripts` | Episodes across OP3 that carry a `podcast:transcript` tag |
| `op3_verify_prefix` | Whether OP3 is receiving downloads for a feed, and what is wrong if not |
| `op3_query_downloads` | Raw download rows, every filter OP3 offers. The escape hatch |
| `op3_query_hits` | Raw request log across OP3. A verification surface, not an analytics one |

## 7. Reading the numbers 📊

The part worth more than the upstream API docs. All of it was found by probing
the live API, because OP3's OpenAPI document declares no response schemas.

**A download is not a person.** It is an app fetching a file. Podcast analytics
across the industry quotes downloads, and a show with a loyal audience whose
apps re-request looks larger than a show with more actual listeners.
`op3_audience_summary` gives both numbers and the ratio.

**Episodes are not comparable on totals.** An older episode has had longer to
accumulate downloads. `op3_episode_curve` compares at equal age against the
show's own median, and excludes episodes younger than the horizon from that
median so a three-day-old episode does not drag a thirty-day comparison down.

**App share on its own says almost nothing.** Nearly every show's biggest app is
Apple Podcasts, because Apple is around 38% of all podcast listening. A show at
40% Apple is *under*-indexed. `op3_benchmark_apps` divides by the global share
so the number means something.

**`bots` does more than add bots.** With it off, OP3 applies its published
download calculation, which deduplicates repeat requests. With it on you get raw
request rows. On one probe the same window returned 213 against 345, and only 79
of the difference were bot rows.

**Rolled-up figures lag about a day.** They carry an `asof` date. That is why
they will not match a live dashboard exactly.

**An empty episode list is normal for a small show.** OP3's daily rollup has not
covered it yet. The show-level total may still be there.

**Metro codes are US-only.** They are a US broadcast concept. Use
`level=region` for a worldwide breakdown.

**Raw download rows come back oldest first.** OP3 offers no way to reverse that
on this endpoint, so a limit takes the earliest rows in the window. Narrow the
window to see recent activity rather than raising the limit.

**Some shows cannot be filtered by episode.** OP3 derives the episode id from
the episode audio URL, so a host that regenerates those URLs leaves historical
rows carrying ids that no longer appear in the feed. Checked across three shows,
two matched exactly and one had no overlap at all. `op3_episode_curve` detects
this and says so rather than returning silent zeros.

**The raw endpoints are scans, not indexes.** Two rows took 2790ms when probed.
Cost grows with the window. The server pages with a continuation token, caps
what it will pull, and labels any result that was cut short, because a truncated
result presented as complete makes every rate computed from it wrong.

## 8. Your data 🔐

There is no backend. The server runs on your machine, talks to `op3.dev`, and
stores nothing on disk.

Responses are cached in memory for five minutes so an agent asking several
questions about one show does not pay for the same scan repeatedly. That cache
dies with the process. Set `OP3_CACHE_TTL_MS=0` to disable it.

**Per-listener identifiers never leave the server.** OP3's raw row carries
`audienceId` and `hashedIpAddress`. Both are aggregated over inside the process
and stripped from anything returned. Every audience figure is a count, a rate or
a distribution.

This is deliberate. OP3 exists to be a privacy-preserving analytics service, and
a wrapper that streamed stable per-listener keys into a model context would undo
that. `op3_query_downloads` can emit a shortened, non-reversible label if you
need to tell rows apart by listener, and it is off by default.

**Third-party text.** Show and episode titles come from arbitrary RSS feeds.
Anyone can publish a podcast, so that text is attacker-controlled and reaches
the model inside a tool result. The server neutralises fence-breaking and tells
the model in its instructions to treat it as data. That raises the cost of an
injection rather than removing it. The real reason the blast radius is small is
that this server is read-only and reaches nothing but OP3.

### Settings

| Variable | Default | Does |
|---|---|---|
| `OP3_TOKEN` | preview token | Your bearer token from op3.dev/api/keys |
| `OP3_REQUEST_TIMEOUT_MS` | 45000 | Per-request deadline |
| `OP3_MIN_REQUEST_INTERVAL_MS` | 150 | Spacing between requests |
| `OP3_MAX_ROWS` | 50000 | Cap on rows any one analysis pulls |
| `OP3_MAX_PAGES` | 40 | Cap on continuation pages |
| `OP3_CACHE_TTL_MS` | 300000 | Response cache lifetime, 0 disables |
| `OP3_HTTP_PORT` | 8787 | Port for `--http` |
| `OP3_HTTP_HOST` | 127.0.0.1 | Bind address for `--http` |
| `OP3_HTTP_TOKEN` | none | Require this bearer token on HTTP requests |

## 9. Troubleshooting 🔧

Run `doctor` first. It names the problem in one command.

```bash
npx -y @thenavidm/op3-mcp@latest doctor
```

| Symptom | Cause and fix |
|---|---|
| "OP3 has nothing at /shows/..." | The show has no OP3 prefix on its feed. Run `op3_verify_prefix`, then op3.dev/setup |
| Downloads are zero but the show exists | The prefix was added recently and nothing has come through. Widen the lookback |
| Every row is a bot | The prefix works but no listener has downloaded yet |
| A tool times out | The window is too wide for a scan. Narrow it or raise `OP3_REQUEST_TIMEOUT_MS` |
| A result says it was truncated | A cap stopped the pull. Narrow the window, or raise `OP3_MAX_ROWS` |
| `op3_episode_curve` returns zeros with a warning | The host regenerates episode URLs, so episode ids do not line up. Show-level tools still work |
| Rate limited on the preview token | It is shared. Get your own at op3.dev/api/keys |

## FAQ ❓

<details>
<summary><b>What is an MCP server?</b></summary>

An MCP server is a standard way to give an AI assistant tools it can actually call. Model Context Protocol is the agreement they speak, so any MCP client connects to any MCP server. This one exposes 22 read-only tools over OP3.

</details>

<details>
<summary><b>Do I need a podcast?</b></summary>

It does not. The token reads public OP3 data, which covers every show that has the prefix on its feed.

</details>

<details>
<summary><b>Do I need an OP3 account?</b></summary>

You do not need an account, though you should get a token. Without one the server uses OP3's shared preview token, which is rate limited.

</details>

<details>
<summary><b>Does this work with my hosting platform?</b></summary>

It works with any podcast whose feed carries the OP3 prefix, whoever hosts it.

</details>

<details>
<summary><b>Why are the numbers different from Apple or Spotify?</b></summary>

Those report only their own listeners. OP3 sits in front of the audio file, so it sees every download regardless of app.

</details>

<details>
<summary><b>Can it write anything?</b></summary>

It does not. OP3's API is read-only and so is this.

</details>

<details>
<summary><b>Is my listener data exposed to the model?</b></summary>

It does not. Per-listener identifiers are aggregated inside the server and stripped from every response.

</details>

<details>
<summary><b>Why is it slow sometimes?</b></summary>

The raw endpoints are scans. Cost grows with the window. The rolled-up tools answer in milliseconds; prefer them.

</details>

<details>
<summary><b>Does it work with claude.ai?</b></summary>

It works over the HTTP transport, which needs a public HTTPS URL. See section 4.

</details>

<details>
<summary><b>How do I update it?</b></summary>

With `@latest` in the install line, the next published version reaches you the next time your client starts the server.

</details>

## Questions

Run into a problem or have a question? [Open an issue](https://github.com/navidmoazzez/op3-mcp/issues) and I will help.

## About the author 👋

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=op3-mcp)
- Navid Media: [navid.media](https://navid.media?utm_source=github&utm_medium=readme&utm_campaign=op3-mcp)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

## Dependencies

| Library | License | What it does |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server and transports |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

Nothing else. The OP3 client, the pagination, the aggregation and the time
handling are all built in, so the install is two packages deep.

## License

[MIT](https://github.com/navidmoazzez/op3-mcp/blob/main/LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to the Open Podcast Prefix Project.

---

© 2026 [NM Media](https://navid.media?utm_source=github&utm_medium=readme&utm_campaign=op3-mcp). Made with ❤️ by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=op3-mcp).
