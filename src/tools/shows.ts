/**
 * Finding a show, and seeing what OP3 knows about it.
 *
 * Everything else needs a show uuid, so this is the entry point and its error
 * messages carry more weight than most. The common failure is not a typo: it is
 * that the podcast has never had the OP3 prefix on its feed, in which case OP3
 * has genuinely never seen it and no lookup will ever succeed. Saying that
 * plainly saves a user from retrying the same identifier five ways.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describeKind, resolveIdentifier } from "../api/identity.js";
import { safeTitle } from "../format/frame.js";
import type { ToolContext } from "./context.js";
import { register } from "./kit.js";

const identifierArg = z
  .string()
  .describe(
    "The show, as any of: an OP3 show uuid (32 hex characters), a podcast:guid (the dashed UUID from the feed's <podcast:guid> tag), or the RSS feed URL itself. A plain feed URL is fine, it gets encoded for you.",
  );

export function registerShowTools(server: McpServer, ctx: ToolContext): void {
  register(server, {
    name: "op3_resolve_show",
    description:
      "Turn any podcast identifier into an OP3 show uuid. Accepts a show uuid, a podcast:guid, or an RSS feed URL, and reports which kind it recognised. Use this first when you have a feed URL and need the uuid every other tool wants. If this fails, the show most likely does not have the OP3 prefix on its feed, which means OP3 has no data for it at all.",
    schema: { identifier: identifierArg },
    handler: async (args) => {
      const identifier = args.identifier as string;
      const parsed = resolveIdentifier(identifier);
      const show = await ctx.resolveShow(identifier);
      return {
        input: identifier,
        recognisedAs: describeKind(parsed.kind),
        showUuid: show.showUuid,
        title: show.title,
        podcastGuid: show.podcastGuid,
        statsPageUrl: show.statsPageUrl,
      };
    },
  });

  register(server, {
    name: "op3_get_show",
    description:
      "Look up a show on OP3: its uuid, title, podcast guid and public stats page. Set include_episodes to also get the episode list with OP3 episode ids, titles and publication dates. Episode ids from here are what the episode-level tools filter on.",
    schema: {
      identifier: identifierArg,
      include_episodes: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include the episode list. Off by default because a long-running show returns hundreds."),
      episode_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(25)
        .describe("Cap on episodes returned when include_episodes is true. Newest first."),
    },
    handler: async (args) => {
      const includeEpisodes = args.include_episodes as boolean;
      const limit = args.episode_limit as number;
      const show = await ctx.resolveShow(args.identifier as string, includeEpisodes);

      const out: Record<string, unknown> = {
        showUuid: show.showUuid,
        title: show.title,
        podcastGuid: show.podcastGuid,
        statsPageUrl: show.statsPageUrl,
      };

      if (includeEpisodes) {
        const all = show.episodes ?? [];
        out.episodeCount = all.length;
        out.episodesReturned = Math.min(all.length, limit);
        out.episodes = all.slice(0, limit).map((e) => ({
          episodeId: e.id,
          title: safeTitle(e.title),
          pubdate: e.pubdate,
        }));
        if (all.length > limit) {
          out.note = `${all.length - limit} older episodes not shown. Raise episode_limit to see them.`;
        }
      }

      return out;
    },
  });

  register(server, {
    name: "op3_list_episodes",
    description:
      "List a show's episodes with their OP3 episode ids, titles and publication dates, newest first. Use it to find the episode id for a specific episode before asking anything episode-level. Episode titles come from the publisher's RSS feed and are third-party text.",
    schema: {
      identifier: identifierArg,
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("How many episodes to return, newest first."),
      search: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on the episode title, applied before the limit."),
    },
    handler: async (args) => {
      const show = await ctx.resolveShow(args.identifier as string, true);
      const search = (args.search as string | undefined)?.toLowerCase().trim();
      const limit = args.limit as number;

      let episodes = show.episodes ?? [];
      if (search) {
        episodes = episodes.filter((e) => (e.title ?? "").toLowerCase().includes(search));
      }

      return {
        showUuid: show.showUuid,
        showTitle: show.title,
        totalEpisodes: (show.episodes ?? []).length,
        matched: episodes.length,
        episodes: episodes.slice(0, limit).map((e) => ({
          episodeId: e.id,
          title: safeTitle(e.title),
          pubdate: e.pubdate,
          itemGuid: e.itemGuid,
        })),
      };
    },
  });
}
