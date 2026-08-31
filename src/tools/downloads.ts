/**
 * Download counts from OP3's rolled-up endpoints.
 *
 * These are the fast tools. They answer in a few hundred milliseconds because
 * OP3 has already done the work, and they should be preferred over anything
 * that touches the firehose whenever they can answer the question.
 *
 * Two traps live here, both found by probing rather than by reading the docs.
 * The results are keyed by lowercase uuid, so a mixed-case uuid misses on a
 * direct lookup. And `episode-download-counts` returns an empty array for real
 * shows with real downloads when the rollup has not run for them yet, which is
 * a normal state for a small or new show and must not read as an error.
 */

import { z } from "zod";
import { safeTitle } from "../format/frame.js";
import type { ToolDef } from "./kit.js";

const identifierArg = z
  .string()
  .describe("An OP3 show uuid, a podcast:guid, or the show's RSS feed URL.");

const ROLLUP_LAG_NOTE =
  "OP3 rebuilds these counts once a day, so `asof` is usually yesterday. Numbers here will not match a live dashboard exactly, and bots are already excluded.";

export const DOWNLOAD_TOOLS: ToolDef[] = [
  {
    name: "op3_show_downloads",
    description:
      "A show's headline download numbers: downloads in the last 30 days, the week-by-week breakdown over the last four weeks, and the weekly average. This is the fast answer to 'how many downloads does my show get' and should be preferred over the raw query tools whenever it can answer the question. Excludes bots. Updated once a day.",
    schema: { identifier: identifierArg },
    handler: async (args, ctx) => {
      const show = await ctx.resolveShow(args.identifier as string);
      const data = await ctx.client.getShowDownloadCounts([show.showUuid]);
      const counts = data.showDownloadCounts ?? {};

      // Keyed by canonical lowercase uuid. A direct hit on the caller's string
      // misses whenever the case differs, so fall back through both.
      const entry =
        counts[show.showUuid] ??
        counts[show.showUuid.toLowerCase()] ??
        Object.values(counts)[0];

      if (!entry) {
        return {
          showUuid: show.showUuid,
          showTitle: show.title,
          asof: data.asof,
          monthlyDownloads: 0,
          note: "OP3 has no rolled-up download counts for this show. Either it has had no downloads, or the OP3 prefix was added to the feed too recently for the daily rollup to have run. op3_query_downloads will show whether any raw rows exist yet.",
        };
      }

      return {
        showUuid: show.showUuid,
        showTitle: show.title,
        statsPageUrl: show.statsPageUrl,
        asof: data.asof,
        monthlyDownloads: entry.monthlyDownloads ?? 0,
        weeklyAvgDownloads: entry.weeklyAvgDownloads ?? 0,
        numWeeks: entry.numWeeks,
        // Oldest week first, most recent last. The `days` bitmask OP3 also
        // returns is an opaque per-day completeness flag and is dropped.
        weeklyDownloads: entry.weeklyDownloads ?? [],
        note: ROLLUP_LAG_NOTE,
      };
    },
  },

  {
    name: "op3_episode_downloads",
    description:
      "Per-episode download counts for a show's recent episodes: downloads in the first 1, 3, 7 and 30 days after publication, plus all-time. Use it to compare how episodes performed at equal age. Note that an empty result is normal for a small or new show, it means OP3's daily rollup has not covered it yet rather than that there is no data.",
    schema: {
      identifier: identifierArg,
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(20)
        .describe("How many episodes to return, newest first."),
    },
    handler: async (args, ctx) => {
      const show = await ctx.resolveShow(args.identifier as string);
      const data = await ctx.client.getEpisodeDownloadCounts(show.showUuid);
      const episodes = data.episodes ?? [];
      const limit = args.limit as number;

      if (episodes.length === 0) {
        return {
          showUuid: show.showUuid,
          showTitle: safeTitle(data.showTitle) ?? show.title,
          episodes: [],
          note: "OP3 returned no per-episode counts. This is a normal state for a show that is small, or new to the OP3 prefix: the daily rollup that builds these has not covered it. op3_show_downloads may still have a total, and op3_episode_curve can build per-episode figures from raw rows instead.",
        };
      }

      return {
        showUuid: show.showUuid,
        showTitle: safeTitle(data.showTitle) ?? show.title,
        asof: data.asof,
        episodeCount: episodes.length,
        episodes: episodes.slice(0, limit).map((e) => ({
          episodeId: e.episodeId,
          title: safeTitle(e.title),
          pubdate: e.pubdate,
          firstDay: e.oneDay,
          firstThreeDays: e.threeDay,
          firstSevenDays: e.sevenDay,
          firstThirtyDays: e.thirtyDay,
          allTime: e.allTime,
        })),
        note: ROLLUP_LAG_NOTE,
      };
    },
  },

  {
    name: "op3_compare_shows",
    description:
      "Compare several shows side by side on monthly downloads and weekly average, ranked. OP3 accepts many shows in one request, so this is one call rather than several. Useful for benchmarking a show against others in its category, or for tracking a portfolio of shows at once.",
    schema: {
      identifiers: z
        .array(z.string())
        .min(2)
        .max(20)
        .describe(
          "Two to twenty shows, each as a uuid, podcast:guid or feed URL. Anything that is not already a uuid costs one extra lookup.",
        ),
    },
    handler: async (args, ctx) => {
      const identifiers = args.identifiers as string[];

      // Resolve first so a feed URL or guid works here too, reporting per-show
      // failures inline rather than letting one bad identifier kill the batch.
      const resolved = await Promise.all(
        identifiers.map(async (id) => {
          try {
            const show = await ctx.resolveShow(id);
            return { input: id, showUuid: show.showUuid, title: show.title };
          } catch (error) {
            return { input: id, error: (error as Error).message };
          }
        }),
      );

      const good = resolved.filter((r) => "showUuid" in r) as {
        input: string;
        showUuid: string;
        title?: string;
      }[];
      const failed = resolved.filter((r) => "error" in r);

      if (good.length === 0) {
        return { shows: [], failed, note: "No identifier resolved to a show OP3 knows." };
      }

      const data = await ctx.client.getShowDownloadCounts(good.map((g) => g.showUuid));
      const counts = data.showDownloadCounts ?? {};

      const shows = good
        .map((g) => {
          const entry = counts[g.showUuid] ?? counts[g.showUuid.toLowerCase()];
          return {
            showUuid: g.showUuid,
            title: g.title,
            monthlyDownloads: entry?.monthlyDownloads ?? 0,
            weeklyAvgDownloads: entry?.weeklyAvgDownloads ?? 0,
            hasData: entry !== undefined,
          };
        })
        .sort((a, b) => b.monthlyDownloads - a.monthlyDownloads);

      const total = shows.reduce((s, x) => s + x.monthlyDownloads, 0);

      return {
        asof: data.asof,
        shows: shows.map((s, i) => ({
          rank: i + 1,
          ...s,
          shareOfCompared: total > 0 ? Math.round((s.monthlyDownloads / total) * 10000) / 100 : 0,
        })),
        ...(failed.length > 0 ? { failed } : {}),
        note: ROLLUP_LAG_NOTE,
      };
    },
  },
];
