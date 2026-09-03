# Install

## Getting an OP3 token, and getting your podcast into OP3

Two separate things, and most people only need the first.

## 1. A token, to read data

You do not need one to try the server. OP3 publishes a shared preview token and
the server falls back to it. That token is rate limited and OP3 can withdraw it,
so get your own before you rely on it.

You do not need to own a podcast for this. The token reads public OP3 data,
which covers every show that has the prefix on its feed.

1. Go to [op3.dev/api/keys](https://op3.dev/api/keys).
2. Create an API key.
3. Copy the bearer token it gives you.
4. Set it as `OP3_TOKEN` in your MCP client config.

Check it:

```bash
npx -y @thenavidm/op3-mcp@latest doctor
```

The token check should stop mentioning the preview token.

### To revoke

Delete the key on the same page. It stops working immediately. There is nothing
to clean up on this side, since the server stores nothing.

## 2. The prefix, to get your own podcast measured

This one is a change to your podcast feed, not to this server.

OP3 works by sitting in front of your episode audio. You put
`https://op3.dev/e/` at the front of each episode's audio URL, so a download
hits OP3 first, gets logged, and is redirected to the real file.

Until that is in place, OP3 has never seen your show and no tool here can report
on it. A show that was never prefixed and a show with no downloads look exactly
the same from the API.

The current instructions are at [op3.dev/setup](https://op3.dev/setup). Most
podcast hosts have a field for a prefix, so it is usually one paste in the
hosting dashboard rather than editing XML.

### After you add it

1. Publish the feed.
2. Wait for a listener to download an episode. Nothing appears before that.
3. Check it landed:

```
op3_verify_prefix with your feed URL
```

That tool separates the three cases that otherwise look identical: the prefix is
not on the feed, it is on the feed but nothing has come through yet, or it is
working.

### Two things that catch people

**The prefix has to be on the live feed**, not only saved in the hosting
dashboard. Some hosts require a republish before the change reaches the feed
URL that apps actually fetch.

**Existing episodes may not be backfilled.** Depending on the host, the prefix
may apply only to new episodes, in which case OP3 starts counting from then.
There is no way to recover downloads from before the prefix existed.

### A note on episode ids

OP3 derives an episode's id from its audio URL. If your host regenerates those
URLs, historical download rows keep the old ids and stop matching the ids in
your current feed listing. Show-level numbers are unaffected. Per-episode
filtering stops working until the ids line up again, and
`op3_episode_curve` will tell you when it detects this.
