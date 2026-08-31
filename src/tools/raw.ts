/**
 * The escape hatch, and the setup check.
 *
 * `op3_query_downloads` exists because no fixed set of aggregations covers
 * every question, and a wrapper that only offers its own opinions is a worse
 * tool than the API it wraps. It is deliberately last in the tool list and its
 * description points at the aggregating tools first, because a model that
 * reaches for raw rows to answer "how many downloads" burns a large amount of
 * context to recompute something a rolled-up endpoint already knows.
 *
 * `op3_verify_prefix` exists because the single most common OP3 problem is not
 * an analytics question at all. It is that the prefix was added to the feed
 * wrongly, or added and never picked up, and every downstream number is zero
 * with nothing to say why.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { distribution } from "../analytics/rollup.js";
import { safeTitle } from "../format/frame.js";
import { REDACTION_NOTE, pseudonymise, redactDownloadRow, redactHitRow } from "../format/redact.js";
import { buildWindow, describeWindow } from "../format/time.js";
import { resolveIdentifier, toBase64FeedUrl } from "../api/identity.js";
import type { ToolContext } from "./context.js";
import { register } from "./kit.js";

export function registerRawTools(server: McpServer, ctx: ToolContext): void {
  register(server, {
    name: "op3_query_downloads",
    description:
      "Raw download rows for a show, with every filter OP3 offers. This is the escape hatch for questions the aggregating tools do not cover. Prefer op3_show_downloads, op3_audience_summary, op3_geography or op3_app_share when they can answer the question, because raw rows are slow to fetch and expensive to reason over. Rows come back oldest first and OP3 offers no way to reverse that on this endpoint, so the limit takes the earliest rows in the window: to see recent activity, narrow the window with start rather than raising the limit. Per-listener identifiers are removed from the output.",
    schema: {
      identifier: z
        .string()
        .describe("An OP3 show uuid, a podcast:guid, or the show's RSS feed URL."),
      start: z.string().optional().describe("Window start, e.g. -24h, -7d, 2026-08-01. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      episode_id: z
        .string()
        .optional()
        .describe("Restrict to one episode, by its 64-character OP3 episode id."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .default(100)
        .describe("Rows to return. Kept low on purpose: these rows are wide and fill a context window fast."),
      bots: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Return raw request rows instead of OP3's deduplicated download count. This adds bot traffic and also switches off OP3's download calculation, so the row count rises for reasons beyond bots. Off by default, which matches every other download figure OP3 reports.",
        ),
      include_listener_keys: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include a shortened, non-reversible listener label so rows can be told apart by listener. The full audienceId and hashedIpAddress are never returned either way.",
        ),
    },
    handler: async (args) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);
      const limit = args.limit as number;
      const withKeys = args.include_listener_keys as boolean;

      const page = await ctx.client.getDownloadsPage(showUuid, {
        start: window.start,
        end: window.end,
        episodeId: (args.episode_id as string | undefined) || undefined,
        limit,
        bots: args.bots as boolean,
      });

      const rows = (page.rows ?? []).map((row) => ({
        ...redactDownloadRow(row),
        ...(withKeys ? { listener: pseudonymise(row.audienceId) } : {}),
      }));

      return {
        showUuid,
        window: describeWindow(window),
        rowsReturned: rows.length,
        ordering: "oldest first, which is the only order OP3 offers on this endpoint",
        moreAvailable: Boolean(page.continuationToken) && rows.length >= limit,
        queryTimeMs: page.queryTime,
        rows,
        privacy: REDACTION_NOTE,
        ...(rows.length >= limit
          ? {
              note: "The limit was reached, so these are the earliest rows in the window, not the most recent. To see recent activity, move start closer to now. For counting or ranking across a whole window, use an aggregating tool instead, which pages internally.",
            }
          : {}),
      };
    },
  });

  register(server, {
    name: "op3_query_hits",
    description:
      "Raw request rows from OP3's redirect log, across every show unless filtered by url. This is the lowest level OP3 exposes and it is a verification surface rather than an analytics one: it shows individual requests including user agents, byte ranges and the edge that served them. For questions about a specific show's performance, use the show tools instead.",
    schema: {
      start: z.string().optional().describe("Window start, e.g. -1h, -24h. Defaults to -1h, because this is a firehose across all shows."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      url: z
        .string()
        .optional()
        .describe(
          "Filter by episode URL. Supports a trailing wildcard for a starts-with match, which is how you scope this to one show or one host.",
        ),
      limit: z.number().int().min(1).max(1000).optional().default(50).describe("Rows to return."),
      newest_first: z.boolean().optional().default(true).describe("Sort most recent first."),
    },
    handler: async (args) => {
      const window = buildWindow((args.start as string | undefined) ?? "-1h", args.end as string | undefined);

      const page = await ctx.client.getHitsPage({
        start: window.start,
        end: window.end,
        url: args.url as string | undefined,
        limit: args.limit as number,
        desc: args.newest_first as boolean,
      });

      return {
        window: describeWindow(window),
        scope: args.url ? `requests matching ${args.url as string}` : "every show OP3 serves",
        rowsReturned: (page.rows ?? []).length,
        queryTimeMs: page.queryTime,
        rows: (page.rows ?? []).map(redactHitRow),
        privacy: REDACTION_NOTE,
      };
    },
  });

  register(server, {
    name: "op3_verify_prefix",
    description:
      "Check whether OP3 is actually receiving downloads for a show, and say what is wrong when it is not. Run this first whenever the numbers are zero or a show cannot be found. It separates the three cases that look identical from the outside: the prefix was never added to the feed, it was added but no download has come through yet, or it is working and the answer is genuinely a small number.",
    schema: {
      identifier: z
        .string()
        .describe(
          "The show, as a uuid, podcast:guid, or RSS feed URL. A feed URL is the most useful input here, because the failure being diagnosed is usually that OP3 has never seen that feed.",
        ),
      lookback: z
        .string()
        .optional()
        .default("-7d")
        .describe("How far back to look for any request at all."),
    },
    handler: async (args) => {
      const identifier = args.identifier as string;
      const lookback = args.lookback as string;
      const parsed = resolveIdentifier(identifier);

      const checks: { check: string; result: string; ok: boolean }[] = [];

      let showUuid: string | undefined;
      let showTitle: string | undefined;

      try {
        const show = await ctx.resolveShow(identifier);
        showUuid = show.showUuid;
        showTitle = show.title;
        checks.push({
          check: "OP3 knows this show",
          result: `Yes: ${show.title ?? show.showUuid}`,
          ok: true,
        });
      } catch (error) {
        checks.push({
          check: "OP3 knows this show",
          result: `No. ${(error as Error).message}`,
          ok: false,
        });
        return {
          identifier,
          recognisedAs: parsed.kind,
          healthy: false,
          checks,
          diagnosis:
            "OP3 has never seen this show. The OP3 prefix is not on the feed's episode URLs, or it was added and no download has come through since. Add https://op3.dev/e/ in front of the episode audio URL, publish the feed, and wait for one download.",
          setupUrl: "https://op3.dev/setup",
          ...(parsed.kind === "feedUrl"
            ? { base64FeedUrl: toBase64FeedUrl(identifier) }
            : {}),
        };
      }

      const window = buildWindow(lookback, undefined);
      const page = await ctx.client.getDownloadsPage(showUuid, {
        start: window.start,
        limit: 200,
        // Bots included on purpose: this is a plumbing check, and a feed that is
        // only being fetched by bots is a meaningfully different diagnosis from
        // one nothing is fetching at all.
        bots: true,
      });
      const rows = page.rows ?? [];

      checks.push({
        check: `Downloads recorded in the last ${describeWindow(window)}`,
        result: rows.length > 0 ? `Yes: ${rows.length} rows found` : "None",
        ok: rows.length > 0,
      });

      const botRows = rows.filter((r) => r.agentType === "bot").length;
      const humanRows = rows.length - botRows;

      if (rows.length > 0) {
        checks.push({
          check: "Non-bot downloads present",
          result:
            humanRows > 0
              ? `Yes: ${humanRows} of ${rows.length} rows are not bots`
              : `No: all ${rows.length} rows are bots`,
          ok: humanRows > 0,
        });
        checks.push({
          check: "Episodes being attributed",
          result: `${distribution(rows, (r) => r.episodeId).distinct} distinct episodes seen`,
          ok: true,
        });
      }

      const healthy = rows.length > 0 && humanRows > 0;

      return {
        identifier,
        recognisedAs: parsed.kind,
        showUuid,
        showTitle: safeTitle(showTitle),
        healthy,
        checks,
        diagnosis: healthy
          ? "The prefix is working. OP3 is receiving and attributing downloads for this show."
          : rows.length === 0
            ? `OP3 knows the show but has recorded no downloads in the last ${describeWindow(window)}. If the prefix was added recently, wait for a listener to download an episode. If it has been longer, check that the prefix is on the episode audio URLs in the live feed rather than only in the hosting dashboard.`
            : "Every request recorded is from a known bot, so the prefix is working but no real listener has downloaded an episode in this window. Widen the lookback.",
        setupUrl: healthy ? undefined : "https://op3.dev/setup",
        statsPageUrl: showUuid ? `https://op3.dev/show/${showUuid}` : undefined,
      };
    },
  });
}
