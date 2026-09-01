# Working on op3-mcp

For agents editing this repository. Users read the README. Driving the server is
`SKILL.md`.

## What this is

22 read-only tools over OP3, the Open Podcast Prefix Project. OP3 sits in front
of the audio file, so it counts every download regardless of which app made it,
which is why its numbers differ from Apple's or Spotify's own dashboards.

## Non-negotiables

**Commit as `n@navid.me`.** Never pass `-c user.email=`. The global config is
correct and the override is the bug.

**Everything reads. There is no write path**, and OP3 exposes none. Do not add a
tool that implies otherwise.

**No data is the normal answer, not a failure.** OP3 only sees a show if the
prefix is on its feed, so a feed without it returns nothing and always will.
Say that plainly rather than retrying with different arguments, or the model
reports a working system as broken.

**Never present OP3 numbers as comparable to a platform dashboard.** Apple and
Spotify report their own listeners only. Explaining the difference is part of
answering the question, not a footnote.

**The shared preview token is rate limited** and is a fallback, not the intended
setup. A user hitting limits needs their own token, not a retry.

## Before claiming it works

```bash
npm run build && npm test && npm run typecheck
npx @modelcontextprotocol/inspector node dist/index.js
```
