/**
 * Change over time, and the episode benchmark.
 *
 * `op3_episode_curve` is the one worth pointing a user at. Comparing episodes
 * on total downloads is meaningless because an old episode has had longer to
 * accumulate them. Comparing at equal age, day N after publication against the
 * show's own median at day N, converts "is this episode doing well" from an
 * opinion into arithmetic. Nothing in OP3's API offers it, and it is only
 * possible because the raw rows carry publication-relative timing.
 */

import { z } from "zod";
import { episodeCurve, listeningPatterns, series } from "../analytics/trend.js";
import { REDACTION_NOTE } from "../format/redact.js";
import { buildWindow, describeWindow } from "../format/time.js";
import { isEpisodeId } from "../api/identity.js";
import { truncationNote } from "./kit.js";
import type { ToolDef } from "./kit.js";

const identifierArg = z
  .string()
  .describe("An OP3 show uuid, a podcast:guid, or the show's RSS feed URL.");

export const TREND_TOOLS: ToolDef[] = [
  {
    name: "op3_download_trend",
    description:
      "A show's downloads and unique listeners over time, bucketed by day, week or month, with a growth rate and the peak period. Growth compares the two halves of the window rather than first period against last, because podcast downloads are weekly-seasonal enough that comparing endpoints is close to noise.",
    schema: {
      identifier: identifierArg,
      granularity: z
        .enum(["day", "week", "month"])
        .optional()
        .default("day")
        .describe("Bucket size. Use week or month for windows longer than a couple of months."),
      start: z
        .string()
        .optional()
        .describe("Window start, e.g. -90d, -12w, 2026-01-01. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      bots: z.boolean().optional().default(false).describe("Include known bots. Off by default."),
    },
    handler: async (args, ctx) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);

      const pull = await ctx.client.getAllDownloads(showUuid, {
        start: window.start,
        end: window.end,
        bots: args.bots as boolean,
      });

      const result = series(pull.rows, args.granularity as "day" | "week" | "month");

      return {
        showUuid,
        window: describeWindow(window),
        ...result,
        interpretation:
          result.points.length < 4
            ? "Too few periods to read a trend from."
            : result.growthRate >= 15
              ? `Growing: the second half of the window is ${result.growthRate}% ahead of the first.`
              : result.growthRate <= -15
                ? `Declining: the second half of the window is ${Math.abs(result.growthRate)}% behind the first.`
                : `Broadly flat, ${result.growthRate}% between the halves of the window.`,
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
        privacy: REDACTION_NOTE.note,
      };
    },
  },

  {
    name: "op3_listening_patterns",
    description:
      "When downloads happen, by hour of day and day of week, in UTC. Useful for choosing a publication slot. Read it as request timing rather than listening behaviour: a podcast app's scheduled background refresh fires on the app's schedule, not when a person pressed play, so the peaks partly reflect app defaults.",
    schema: {
      identifier: identifierArg,
      start: z.string().optional().describe("Window start, e.g. -30d. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      bots: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include known bots. Leave off: bot traffic is often scheduled hourly and will flatten the pattern."),
    },
    handler: async (args, ctx) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);

      const pull = await ctx.client.getAllDownloads(showUuid, {
        start: window.start,
        end: window.end,
        bots: args.bots as boolean,
      });

      return {
        showUuid,
        window: describeWindow(window),
        totalDownloads: pull.rows.length,
        ...listeningPatterns(pull.rows),
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
      };
    },
  },

  {
    name: "op3_episode_curve",
    description:
      "How one episode is tracking against the show's own median at the same age. Returns cumulative downloads by day after publication alongside the median across comparable episodes, plus a verdict. This is the only fair way to judge a recent episode: total downloads always favour older episodes because they have had longer to accumulate. Only episodes at least as old as the horizon go into the median, so a three-day-old episode does not drag a thirty-day comparison toward zero.",
    schema: {
      identifier: identifierArg,
      episode_id: z
        .string()
        .describe(
          "The OP3 episode id, a 64-character hash from op3_list_episodes or op3_get_show with include_episodes.",
        ),
      horizon_days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .default(30)
        .describe("How many days after publication to chart. 30 is the industry convention."),
      compare_episodes: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .default(10)
        .describe("How many other episodes form the median. More is steadier and slower."),
      bots: z.boolean().optional().default(false).describe("Include known bots. Off by default."),
    },
    handler: async (args, ctx) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const episodeId = (args.episode_id as string).trim();
      const horizon = args.horizon_days as number;
      const compareCount = args.compare_episodes as number;
      const bots = args.bots as boolean;

      if (!isEpisodeId(episodeId)) {
        throw new Error(
          `"${episodeId}" is not an OP3 episode id. Episode ids are 64 hex characters and come from op3_list_episodes. An RSS <guid> is not the same thing.`,
        );
      }

      const episodes = await ctx.episodes(showUuid);
      const target = episodes.find((e) => e.id === episodeId);
      if (!target) {
        throw new Error(
          `Episode ${episodeId} is not in show ${showUuid}. Run op3_list_episodes for this show to get valid episode ids.`,
        );
      }

      // Others are the newest episodes excluding the target. Pull each one's
      // rows over the horizon after its own publication, which is why this is
      // several requests rather than one wide window.
      const others = episodes
        .filter((e) => e.id !== episodeId && e.pubdate)
        .slice(0, compareCount);

      const windowFor = (pubdate: string) => {
        const startMs = Date.parse(pubdate);
        return {
          start: new Date(startMs).toISOString(),
          end: new Date(Math.min(startMs + horizon * 86_400_000, Date.now())).toISOString(),
        };
      };

      const targetWindow = target.pubdate ? windowFor(target.pubdate) : undefined;
      if (!targetWindow) {
        throw new Error(
          `Episode ${episodeId} has no publication date in OP3, so there is no age to chart it against.`,
        );
      }

      const targetPull = await ctx.client.getAllDownloads(showUuid, {
        start: targetWindow.start,
        end: targetWindow.end,
        episodeId,
        bots,
      });

      const otherPulls = await Promise.all(
        others.map(async (e) => {
          const w = windowFor(e.pubdate!);
          const pull = await ctx.client
            .getAllDownloads(showUuid, {
              start: w.start,
              end: w.end,
              episodeId: e.id,
              bots,
            })
            .catch(() => ({ rows: [], truncated: false, pages: 0 }));
          return { episodeId: e.id, pubdate: e.pubdate, rows: pull.rows };
        }),
      );

      const titles = await ctx.episodeTitles(showUuid).catch(() => new Map<string, string | undefined>());

      // An all-zero curve has two very different causes and they look identical
      // from here: the episode genuinely had no downloads, or the episode ids in
      // the feed listing do not match the ids on the download rows.
      //
      // The second happens when a host regenerates episode audio URLs, because
      // OP3 derives the episode id from the URL. Historical rows then carry ids
      // for URLs that no longer exist in the feed, and every episode-filtered
      // query silently returns nothing. Checked against three shows, two matched
      // exactly and one had zero overlap, so this is real but not the norm.
      //
      // One extra unfiltered request only when the filtered one came back empty.
      let idMismatch: string | undefined;
      if (targetPull.rows.length === 0) {
        const probe = await ctx.client
          .getDownloadsPage(showUuid, {
            start: targetWindow.start,
            end: targetWindow.end,
            limit: 500,
          })
          .catch(() => undefined);

        const seenIds = new Set(
          (probe?.rows ?? []).map((r) => r.episodeId).filter(Boolean) as string[],
        );
        const feedIds = new Set(episodes.map((e) => e.id));
        const overlap = [...seenIds].filter((id) => feedIds.has(id)).length;

        if (seenIds.size > 0 && overlap === 0) {
          idMismatch =
            "This show's download rows carry episode ids that do not appear in its feed listing, so filtering by episode id returns nothing. That happens when the podcast host regenerates episode audio URLs, because OP3 derives the episode id from the URL. Show-level tools are unaffected; per-episode filtering is not usable for this show until the ids line up. op3_query_downloads without an episode filter will show the ids OP3 actually holds.";
        }
      }

      const curve = episodeCurve(
        {
          episodeId,
          title: titles.get(episodeId),
          pubdate: target.pubdate,
          rows: targetPull.rows,
        },
        otherPulls,
        horizon,
      );

      return {
        showUuid,
        horizonDays: horizon,
        ...curve,
        ...(idMismatch ? { warning: idMismatch } : {}),
        truncated: targetPull.truncated,
        truncationNote: truncationNote(targetPull.truncated, targetPull.stoppedBy, targetPull.rows.length),
      };
    },
  },
];
