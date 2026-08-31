/**
 * Registering every tool, in the order a reader should meet them.
 *
 * Order is not cosmetic. A model scanning the tool list picks the first
 * plausible match, so the cheap rolled-up tools come before the expensive raw
 * ones, and the raw escape hatch comes last.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { registerShowTools } from "./shows.js";
import { registerDownloadTools } from "./downloads.js";
import { registerAudienceTools } from "./audience.js";
import { registerGeographyTools } from "./geography.js";
import { registerAppTools } from "./apps.js";
import { registerTrendTools } from "./trends.js";
import { registerDiscoveryTools } from "./discovery.js";
import { registerRawTools } from "./raw.js";

/** Kept in sync with the CI smoke test, which asserts the count. */
export const TOOL_COUNT = 22;

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerShowTools(server, ctx);
  registerDownloadTools(server, ctx);
  registerAudienceTools(server, ctx);
  registerGeographyTools(server, ctx);
  registerAppTools(server, ctx);
  registerTrendTools(server, ctx);
  registerDiscoveryTools(server, ctx);
  registerRawTools(server, ctx);
}
