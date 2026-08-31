/**
 * Apps and devices, and the benchmark that makes them mean something.
 *
 * OP3 has a ready-made app share endpoint, but it is fixed to the last three
 * calendar months and returns raw download counts with no context. Two things
 * are added here.
 *
 * Any window, by rolling up the raw rows, so app mix can be compared before and
 * after a launch rather than only over OP3's fixed period.
 *
 * And the benchmark. Raw share says "Apple Podcasts is your biggest app", which
 * is true of nearly every show and therefore tells you nothing. Dividing by
 * OP3's global share says where this audience is actually unusual, which is the
 * part worth acting on.
 */

import { z } from "zod";
import { distinctSet, distribution, groupBy, percent } from "../analytics/rollup.js";
import { benchmarkApps } from "../analytics/trend.js";
import { REDACTION_NOTE } from "../format/redact.js";
import { buildWindow, describeWindow } from "../format/time.js";
import type { DownloadRow } from "../api/types.js";
import { truncationNote } from "./kit.js";
import type { ToolDef } from "./kit.js";

const identifierArg = z
  .string()
  .describe("An OP3 show uuid, a podcast:guid, or the show's RSS feed URL.");

type Dimension = "agentName" | "agentType" | "deviceType" | "deviceName";

const DIMENSION_OF: Record<Dimension, (row: DownloadRow) => string | undefined> = {
  agentName: (r) => r.agentName,
  agentType: (r) => r.agentType,
  deviceType: (r) => r.deviceType,
  deviceName: (r) => r.deviceName,
};

export const APP_TOOLS: ToolDef[] = [
  {
    name: "op3_app_share",
    description:
      "Which podcast apps a show's audience uses, over any window you choose, with unique listeners alongside downloads. Prefer this over OP3's built-in app query when the window matters, because OP3's own endpoint is locked to the last three calendar months. Listener share is the more honest column: an app that re-requests files inflates its download share without representing more people.",
    schema: {
      identifier: identifierArg,
      start: z.string().optional().describe("Window start, e.g. -30d. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      top: z.number().int().min(1).max(100).optional().default(20).describe("How many apps to return."),
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

      const dist = distribution(pull.rows, DIMENSION_OF.agentName, { top: args.top as number });
      const grouped = groupBy(pull.rows, DIMENSION_OF.agentName);
      const totalListeners = distinctSet(pull.rows, (r) => r.audienceId).size;

      return {
        showUuid,
        window: describeWindow(window),
        totalDownloads: pull.rows.length,
        totalUniqueListeners: totalListeners,
        distinctApps: dist.distinct,
        apps: dist.buckets.map((b) => {
          const listeners = distinctSet(grouped.get(b.key) ?? [], (r) => r.audienceId).size;
          return {
            app: b.key,
            downloads: b.count,
            downloadShare: b.share,
            uniqueListeners: listeners,
            listenerShare: percent(listeners, totalListeners),
          };
        }),
        otherCount: dist.otherCount,
        withoutApp: dist.missing,
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
        privacy: REDACTION_NOTE.note,
      };
    },
  },

  {
    name: "op3_device_breakdown",
    description:
      "How a show is consumed, across all four dimensions OP3 records: agentType (app, browser, bot), agentName (the specific app), deviceType (mobile, computer, tablet, smart speaker) and deviceName (Apple iPhone, Android Phone). One call returns all four, which is what you want for a picture of the audience rather than a single ranked list.",
    schema: {
      identifier: identifierArg,
      start: z.string().optional().describe("Window start, e.g. -30d. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      top: z.number().int().min(1).max(50).optional().default(10).describe("How many entries per dimension."),
      bots: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include known bots. Worth turning on here specifically, since agentType is the dimension that shows how much bot traffic a feed attracts.",
        ),
    },
    handler: async (args, ctx) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);
      const top = args.top as number;

      const pull = await ctx.client.getAllDownloads(showUuid, {
        start: window.start,
        end: window.end,
        bots: args.bots as boolean,
      });

      const dimensions = Object.fromEntries(
        (Object.keys(DIMENSION_OF) as Dimension[]).map((dim) => {
          const dist = distribution(pull.rows, DIMENSION_OF[dim], { top });
          return [
            dim,
            {
              entries: dist.buckets,
              distinct: dist.distinct,
              missing: dist.missing,
              otherCount: dist.otherCount,
            },
          ];
        }),
      );

      return {
        showUuid,
        window: describeWindow(window),
        totalDownloads: pull.rows.length,
        totalUniqueListeners: distinctSet(pull.rows, (r) => r.audienceId).size,
        dimensions,
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
        privacy: REDACTION_NOTE.note,
      };
    },
  },

  {
    name: "op3_global_app_share",
    description:
      "Podcast app market share across every show OP3 measures, over the last thirty days. This is the industry benchmark, not one show's numbers, and it is useful on its own for questions about the podcast app landscape. Can be narrowed to a single device to see which apps dominate on, say, an Apple iPhone.",
    schema: {
      device_name: z
        .string()
        .optional()
        .describe("Restrict to one device, e.g. 'Apple iPhone'. Device names come from op3_device_breakdown."),
      user_agent: z
        .string()
        .optional()
        .describe("Restrict to the device inferred from a raw user agent string."),
    },
    handler: async (args, ctx) => {
      const data = await ctx.client.getTopApps({
        deviceName: args.device_name as string | undefined,
        userAgent: args.user_agent as string | undefined,
      });
      const shares = data.appShares ?? {};
      const ranked = Object.entries(shares).sort((a, b) => b[1] - a[1]);

      return {
        scope: args.device_name
          ? `OP3-wide, restricted to ${args.device_name as string}`
          : "OP3-wide, all devices",
        period: "last 30 days",
        distinctApps: ranked.length,
        apps: ranked.map(([app, share], i) => ({
          rank: i + 1,
          app,
          share: Math.round(share * 100) / 100,
        })),
      };
    },
  },

  {
    name: "op3_benchmark_apps",
    description:
      "A show's app mix against OP3's global mix, with an index where 100 means exactly average. This is the tool that turns app share into something actionable. A show can be 40% Apple Podcasts and be under-indexed, because Apple is around 38% globally, so raw share hides the real story. Over-indexed apps are where this audience is unusual and where it can be reached deliberately.",
    schema: {
      identifier: identifierArg,
      start: z.string().optional().describe("Window start for the show side, e.g. -30d. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      min_share: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(0.5)
        .describe(
          "Ignore apps below this percentage of the show's downloads. Without a floor, one download from an obscure app reports as a huge over-index.",
        ),
      bots: z.boolean().optional().default(false).describe("Include known bots. Off by default."),
    },
    handler: async (args, ctx) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);

      // The global side is a fixed 30-day window on OP3's side. When the show
      // window differs, the comparison is still directionally right but the
      // periods do not line up, and the response says so rather than pretending.
      const [pull, global] = await Promise.all([
        ctx.client.getAllDownloads(showUuid, {
          start: window.start,
          end: window.end,
          bots: args.bots as boolean,
        }),
        ctx.client.getTopApps(),
      ]);

      const dist = distribution(pull.rows, DIMENSION_OF.agentName);
      const showShares = new Map(dist.buckets.map((b) => [b.key, b.share]));
      const rows = benchmarkApps(showShares, global.appShares ?? {}, args.min_share as number);

      const overIndexed = rows.filter((r) => r.index >= 150);
      const underIndexed = rows.filter((r) => r.index > 0 && r.index <= 66);

      return {
        showUuid,
        window: describeWindow(window),
        globalPeriod: "last 30 days, OP3-wide",
        ...(Math.abs(window.days - 30) > 3
          ? {
              periodMismatch:
                "The show window is not 30 days but OP3's global figures always are, so treat the index as directional rather than exact.",
            }
          : {}),
        totalDownloads: pull.rows.length,
        apps: rows,
        summary: {
          overIndexed: overIndexed.map((r) => r.app),
          underIndexed: underIndexed.map((r) => r.app),
        },
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
      };
    },
  },
];
