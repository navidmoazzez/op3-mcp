/**
 * The whole tool surface, as data.
 *
 * These are definitions rather than registrations, which is what lets one
 * implementation serve two hosts that work very differently.
 *
 * Run over stdio, `registerAllTools` binds them to a server once, with a single
 * context for the process.
 *
 * Run as a hosted connector, the host imports `ALL_TOOLS` and calls
 * `tool.handler(args, ctx)` with a context built per request, because each
 * caller brings their own OP3 token. Baking a context in at module load would
 * hand every caller the first one's credentials.
 *
 * Order is not cosmetic. A model scanning the list picks the first plausible
 * match, so the cheap rolled-up tools come before the expensive raw ones and
 * the escape hatches come last.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { register, type ToolDef } from "./kit.js";
import { SHOW_TOOLS } from "./shows.js";
import { DOWNLOAD_TOOLS } from "./downloads.js";
import { AUDIENCE_TOOLS } from "./audience.js";
import { GEOGRAPHY_TOOLS } from "./geography.js";
import { APP_TOOLS } from "./apps.js";
import { TREND_TOOLS } from "./trends.js";
import { DISCOVERY_TOOLS } from "./discovery.js";
import { RAW_TOOLS } from "./raw.js";

export const ALL_TOOLS: ToolDef[] = [
  ...SHOW_TOOLS,
  ...DOWNLOAD_TOOLS,
  ...AUDIENCE_TOOLS,
  ...GEOGRAPHY_TOOLS,
  ...APP_TOOLS,
  ...TREND_TOOLS,
  ...DISCOVERY_TOOLS,
  ...RAW_TOOLS,
];

/** Kept in sync with the CI smoke test, which asserts the count. */
export const TOOL_COUNT = ALL_TOOLS.length;

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of ALL_TOOLS) register(server, tool, ctx);
}

export {
  SHOW_TOOLS,
  DOWNLOAD_TOOLS,
  AUDIENCE_TOOLS,
  GEOGRAPHY_TOOLS,
  APP_TOOLS,
  TREND_TOOLS,
  DISCOVERY_TOOLS,
  RAW_TOOLS,
};
export type { ToolDef };
