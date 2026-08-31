/**
 * People rather than requests.
 *
 * These are the tools no other OP3 client offers, because they need the raw
 * download rows and the raw rows are awkward: a slow scan, opaque cursor
 * paging, and a per-listener key that has to be aggregated inside the process
 * and never returned.
 *
 * What they buy is the distinction the podcast industry mostly cannot make.
 * A download is an app fetching a file. A listener is a person. One loyal
 * listener whose app re-fetches across three days is three downloads, so a
 * download count alone cannot tell a small loyal audience apart from a large
 * indifferent one.
 *
 * Every number returned here is a count, a rate or a distribution. No
 * identifier leaves this module.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  audienceSummary,
  episodeOverlap,
  newVsReturning,
  retention,
} from "../analytics/audience.js";
import { REDACTION_NOTE } from "../format/redact.js";
import { buildWindow, describeWindow } from "../format/time.js";
import type { ToolContext } from "./context.js";
import { register, truncationNote } from "./kit.js";

const identifierArg = z
  .string()
  .describe("An OP3 show uuid, a podcast:guid, or the show's RSS feed URL.");

const startArg = z
  .string()
  .optional()
  .describe(
    "Window start. A relative value like -30d, -8w or -3m, a date like 2026-08-01, or an ISO timestamp. Defaults to -30d. Wider windows are slower: this reads raw rows, not a rollup.",
  );

const endArg = z
  .string()
  .optional()
  .describe("Window end, same formats as start. Defaults to now.");

const botsArg = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Include downloads from known bots. Off by default, which matches how OP3's own download counts are computed.",
  );

export function registerAudienceTools(server: McpServer, ctx: ToolContext): void {
  register(server, {
    name: "op3_audience_summary",
    description:
      "Unique listeners against downloads for a show over any window. This is the number OP3's own dashboard and every rolled-up endpoint cannot give you: how many people, not how many requests. Read downloadsPerListener as the key figure, near 1 means each download is a distinct person, well above 1 means apps re-requesting the same file and every download number you see elsewhere is inflated by that factor.",
    schema: {
      identifier: identifierArg,
      start: startArg,
      end: endArg,
      bots: botsArg,
    },
    handler: async (args) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);

      const pull = await ctx.client.getAllDownloads(showUuid, {
        start: window.start,
        end: window.end,
        bots: args.bots as boolean,
      });

      const summary = audienceSummary(pull.rows);

      return {
        showUuid,
        window: describeWindow(window),
        ...summary,
        downloadsPerDay: Math.round((summary.downloads / window.days) * 100) / 100,
        listenersPerDay: Math.round((summary.uniqueListeners / window.days) * 100) / 100,
        rowsScanned: pull.rows.length,
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
        privacy: REDACTION_NOTE.note,
      };
    },
  });

  register(server, {
    name: "op3_new_vs_returning",
    description:
      "Split a show's listeners in a window into first-time and returning, by comparing against a longer baseline period immediately before it. Answers whether a show is reaching new people or serving the same audience repeatedly. The baseline length matters: a short baseline calls a monthly listener new, so it defaults to four times the window and both sizes are reported so you can judge the answer.",
    schema: {
      identifier: identifierArg,
      start: startArg,
      end: endArg,
      baseline_multiplier: z
        .number()
        .min(1)
        .max(12)
        .optional()
        .default(4)
        .describe(
          "How many window-lengths of history to treat as the baseline. Higher is more accurate and slower. 4 means a 30-day window is compared against the 120 days before it.",
        ),
      bots: botsArg,
    },
    handler: async (args) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);
      const multiplier = args.baseline_multiplier as number;
      const bots = args.bots as boolean;

      const windowMs = window.endMs - window.startMs;
      const baselineStart = new Date(window.startMs - windowMs * multiplier).toISOString();
      const baselineEnd = new Date(window.startMs).toISOString();

      const [current, baseline] = await Promise.all([
        ctx.client.getAllDownloads(showUuid, {
          start: window.start,
          end: window.end,
          bots,
        }),
        ctx.client.getAllDownloads(showUuid, {
          start: baselineStart,
          end: baselineEnd,
          bots,
        }),
      ]);

      const split = newVsReturning(current.rows, baseline.rows);
      const truncated = current.truncated || baseline.truncated;

      return {
        showUuid,
        window: describeWindow(window),
        baseline: `${baselineStart} to ${baselineEnd} (${((windowMs * multiplier) / 86_400_000).toFixed(1)} days)`,
        ...split,
        interpretation:
          split.windowListeners === 0
            ? "No listeners in the window, so there is nothing to split."
            : split.newShare >= 60
              ? `${split.newShare}% of this window's listeners are new. The show is reaching beyond its existing audience.`
              : split.newShare <= 25
                ? `${split.returningShare}% of this window's listeners were already there. The show is serving a settled audience rather than growing it.`
                : `A mixed window: ${split.newShare}% new, ${split.returningShare}% returning.`,
        truncated,
        truncationNote: truncated
          ? "One or both pulls hit a cap, so the split is computed from a sample. A listener missing from a truncated baseline is wrongly counted as new, which biases newShare upward."
          : undefined,
        privacy: REDACTION_NOTE.note,
      };
    },
  });

  register(server, {
    name: "op3_listener_retention",
    description:
      "Cohort carry-over between two periods: how much of the earlier period's audience showed up again in the later one. Returns two rates that answer different questions. retentionRate is the share of the old audience that came back, which measures whether the show holds people. carryOverShare is the share of the new period that is old faces, which measures whether the show is growing or recycling. A show can score well on one and badly on the other.",
    schema: {
      identifier: identifierArg,
      cohort_start: z
        .string()
        .optional()
        .describe("Start of the earlier period. Defaults to -60d."),
      cohort_end: z
        .string()
        .optional()
        .describe("End of the earlier period, and the start of the later one. Defaults to -30d."),
      later_end: z
        .string()
        .optional()
        .describe("End of the later period. Defaults to now."),
      bots: botsArg,
    },
    handler: async (args) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const bots = args.bots as boolean;

      const cohortStart = (args.cohort_start as string | undefined) ?? "-60d";
      const cohortEnd = (args.cohort_end as string | undefined) ?? "-30d";
      const laterEnd = args.later_end as string | undefined;

      const cohortWindow = buildWindow(cohortStart, cohortEnd);
      const laterWindow = buildWindow(cohortEnd, laterEnd);

      const [cohort, later] = await Promise.all([
        ctx.client.getAllDownloads(showUuid, {
          start: cohortWindow.start,
          end: cohortWindow.end,
          bots,
        }),
        ctx.client.getAllDownloads(showUuid, {
          start: laterWindow.start,
          end: laterWindow.end,
          bots,
        }),
      ]);

      const result = retention(cohort.rows, later.rows);
      const truncated = cohort.truncated || later.truncated;

      return {
        showUuid,
        cohortPeriod: describeWindow(cohortWindow),
        laterPeriod: describeWindow(laterWindow),
        ...result,
        interpretation:
          result.cohortListeners === 0
            ? "No listeners in the earlier period, so there is no cohort to follow."
            : `${result.retentionRate}% of the earlier audience returned. ${result.carryOverShare}% of the later period's listeners were already there, so ${Math.round((100 - result.carryOverShare) * 100) / 100}% of it is new.`,
        truncated,
        truncationNote: truncated
          ? "One or both pulls hit a cap, so these rates are computed from a sample and understate retention: a returning listener missing from a truncated period looks churned."
          : undefined,
        privacy: REDACTION_NOTE.note,
      };
    },
  });

  register(server, {
    name: "op3_episode_overlap",
    description:
      "Which episodes share an audience. For each pair of a show's busiest episodes, reports shared listeners, a symmetric similarity, and the share of the smaller episode's audience that also heard the other. Read the smaller side's share first: for one big episode and one small one the symmetric number is always near zero, while the smaller side's share tells you whether a spike brought genuinely new people or just gave the existing audience another download.",
    schema: {
      identifier: identifierArg,
      start: startArg,
      end: endArg,
      top_episodes: z
        .number()
        .int()
        .min(2)
        .max(15)
        .optional()
        .default(6)
        .describe(
          "How many of the busiest episodes to compare. Pairs grow quadratically, so 6 gives 15 pairs and 15 gives 105.",
        ),
      bots: botsArg,
    },
    handler: async (args) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);

      const pull = await ctx.client.getAllDownloads(showUuid, {
        start: window.start,
        end: window.end,
        bots: args.bots as boolean,
      });

      const titles = await ctx.episodeTitles(showUuid).catch(() => new Map<string, string | undefined>());
      const result = episodeOverlap(pull.rows, titles, {
        topEpisodes: args.top_episodes as number,
      });

      return {
        showUuid,
        window: describeWindow(window),
        episodes: result.episodes,
        pairs: result.pairs,
        rowsScanned: pull.rows.length,
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
        privacy: REDACTION_NOTE.note,
      };
    },
  });
}
