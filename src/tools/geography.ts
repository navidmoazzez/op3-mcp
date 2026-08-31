/**
 * Where the audience is.
 *
 * OP3's row carries continent, country, region and metro, which is four levels
 * where the usual treatment of podcast geography is a country list. The extra
 * levels are the useful part for anyone selling ads or planning a live show,
 * because "23% United States" is not actionable and "8% of everything is the
 * Chicago metro" is.
 *
 * Listener counts sit alongside download counts throughout, because a single
 * enthusiastic listener in a small market otherwise reads as a market.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { distinctSet, distribution, groupBy, percent } from "../analytics/rollup.js";
import { REDACTION_NOTE } from "../format/redact.js";
import { buildWindow, describeWindow } from "../format/time.js";
import type { DownloadRow } from "../api/types.js";
import type { ToolContext } from "./context.js";
import { register, truncationNote } from "./kit.js";

type Level = "continent" | "country" | "region" | "metro" | "timezone";

const KEY_OF: Record<Level, (row: DownloadRow) => string | undefined> = {
  continent: (r) => r.continentCode,
  country: (r) => r.countryCode,
  // Region codes repeat across countries (IL is Illinois and also Israel), so
  // qualify them. Without this a US state silently merges with a country.
  region: (r) => (r.regionName ? `${r.countryCode ?? "??"} / ${r.regionName}` : undefined),
  metro: (r) => (r.metroCode ? `${r.countryCode ?? "??"} / metro ${r.metroCode}` : undefined),
  timezone: (r) => r.timezone,
};

export function registerGeographyTools(server: McpServer, ctx: ToolContext): void {
  register(server, {
    name: "op3_geography",
    description:
      "Where a show's downloads come from, at whichever level you ask for: continent, country, region (state or province), metro area, or timezone. Reports downloads and unique listeners side by side for each place, because one enthusiastic listener in a small market otherwise looks like a market. Region and metro are qualified by country, so Illinois and Israel do not merge.",
    schema: {
      identifier: z
        .string()
        .describe("An OP3 show uuid, a podcast:guid, or the show's RSS feed URL."),
      level: z
        .enum(["continent", "country", "region", "metro", "timezone"])
        .optional()
        .default("country")
        .describe(
          "Granularity. country is the usual answer. region is states and provinces. metro is a US-centric DMA code and is mostly empty outside the US.",
        ),
      start: z
        .string()
        .optional()
        .describe("Window start, e.g. -30d, -8w, 2026-08-01. Defaults to -30d."),
      end: z.string().optional().describe("Window end. Defaults to now."),
      top: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(20)
        .describe("How many places to return. The rest are folded into otherCount rather than dropped."),
      bots: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include downloads from known bots. Off by default."),
    },
    handler: async (args) => {
      const showUuid = await ctx.resolveShowUuid(args.identifier as string);
      const window = buildWindow(args.start as string | undefined, args.end as string | undefined);
      const level = args.level as Level;
      const top = args.top as number;

      const pull = await ctx.client.getAllDownloads(showUuid, {
        start: window.start,
        end: window.end,
        bots: args.bots as boolean,
      });

      const keyOf = KEY_OF[level];
      const dist = distribution(pull.rows, keyOf, { top });

      // Listener counts per place need the grouped rows, not just the counts,
      // so this is a second pass rather than something `distribution` can give.
      const grouped = groupBy(pull.rows, keyOf);
      const totalListeners = distinctSet(pull.rows, (r) => r.audienceId).size;

      const places = dist.buckets.map((b) => {
        const rows = grouped.get(b.key) ?? [];
        const listeners = distinctSet(rows, (r) => r.audienceId).size;
        return {
          place: b.key,
          downloads: b.count,
          downloadShare: b.share,
          uniqueListeners: listeners,
          listenerShare: percent(listeners, totalListeners),
        };
      });

      return {
        showUuid,
        level,
        window: describeWindow(window),
        totalDownloads: pull.rows.length,
        totalUniqueListeners: totalListeners,
        distinctPlaces: dist.distinct,
        places,
        otherCount: dist.otherCount,
        withoutLocation: dist.missing,
        ...(level === "metro" && dist.counted < pull.rows.length * 0.5
          ? {
              note: "Metro codes are a US broadcast concept and are absent for most non-US downloads, so this covers only part of the audience. Use level=region for a worldwide breakdown.",
            }
          : {}),
        truncated: pull.truncated,
        truncationNote: truncationNote(pull.truncated, pull.stoppedBy, pull.rows.length),
        privacy: REDACTION_NOTE.note,
      };
    },
  });
}
