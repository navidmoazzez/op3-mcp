/**
 * Looking across OP3 rather than at one show.
 *
 * The transcript feed is OP3's only cross-show discovery surface. It is a
 * modest endpoint but a genuinely useful one, because a podcast that publishes
 * a `podcast:transcript` tag is machine-readable in a way most are not, which
 * makes this the shortlist for anything that wants to read podcasts rather than
 * count them.
 */

import { z } from "zod";
import { safeTitle } from "../format/frame.js";
import type { ToolDef } from "./kit.js";

export const DISCOVERY_TOOLS: ToolDef[] = [
  {
    name: "op3_recent_transcripts",
    description:
      "Recently published episodes across all of OP3 that carry a podcast:transcript tag, newest first. Use it to find podcasts whose episodes are machine-readable, which is the shortlist worth building on for anything that needs to read transcripts rather than count downloads. Returns podcast guids you can pass straight to the show tools.",
    schema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(25)
        .describe("How many episodes to return, newest first."),
      resolve_shows: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Look each podcast guid up to add the show title and uuid. Costs one request per distinct show, so leave it off for large limits.",
        ),
    },
    handler: async (args, ctx) => {
      const limit = args.limit as number;
      const data = await ctx.client.getRecentTranscripts(limit);
      const episodes = data.rt?.episodes ?? [];

      let titles = new Map<string, { title?: string; showUuid?: string }>();

      if (args.resolve_shows as boolean) {
        const guids = [...new Set(episodes.map((e) => e.podcastGuid).filter(Boolean))] as string[];
        const resolved = await Promise.all(
          guids.map(async (guid) => {
            try {
              const show = await ctx.resolveShow(guid);
              return [guid, { title: show.title, showUuid: show.showUuid }] as const;
            } catch {
              // A guid OP3 lists here but cannot resolve is not an error worth
              // failing the whole call over; the row is still useful without it.
              return [guid, {}] as const;
            }
          }),
        );
        titles = new Map(resolved);
      }

      return {
        asof: data.rt?.asof,
        count: episodes.length,
        episodes: episodes.map((e) => {
          const show = e.podcastGuid ? titles.get(e.podcastGuid) : undefined;
          return {
            pubdate: e.pubdate,
            podcastGuid: e.podcastGuid,
            showTitle: safeTitle(show?.title),
            showUuid: show?.showUuid,
            episodeItemGuid: e.episodeItemGuid,
            hasTranscripts: e.hasTranscripts,
          };
        }),
        note: "This is OP3-wide, not one show. podcastGuid values here can be passed to op3_get_show or any other show tool.",
      };
    },
  },
];
