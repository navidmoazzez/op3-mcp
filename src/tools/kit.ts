/**
 * Shared plumbing for registering a tool.
 *
 * Every OP3 endpoint is a read, so the annotations are the same on all of them
 * and are applied here rather than repeated twenty-two times where they would
 * eventually drift. A client deciding what to auto-approve can trust that
 * uniformity: nothing in this server changes anything.
 *
 * The error handling is the other reason this exists. An MCP tool that throws
 * hands the client a transport-level failure, which most surface to the model as
 * a bare "the tool errored". Returning `isError` with the message keeps every
 * carefully written recovery hint in `api/errors.ts` visible to the model that
 * needs to act on it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import type { ToolContext } from "./context.js";
import { OP3Error } from "../api/errors.js";

/** Read annotations. Identical across this server, because nothing writes. */
export const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Drop null and undefined so a model is not handed a wall of empty fields. */
export function stripEmpty<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripEmpty(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripEmpty(v);
    }
    return out as T;
  }
  return value;
}

export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(stripEmpty(data), null, 2) }],
  };
}

export function fail(error: unknown): CallToolResult {
  const payload =
    error instanceof OP3Error
      ? error.toJSON()
      : { error: (error as Error)?.message ?? String(error), type: "Error" };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

export type ToolDef = {
  name: string;
  description: string;
  schema: ZodRawShape;
  /**
   * Deps arrive as the second argument rather than being closed over.
   *
   * That is what lets the same definitions serve two very different hosts. Run
   * over stdio there is one context for the process. Run as a hosted connector
   * there is one per request, because each caller brings their own OP3 token,
   * and a context baked in at module load would hand every caller the first
   * one's credentials.
   */
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

/**
 * Register one tool against a server, wrapping the handler so a thrown error
 * becomes a readable result rather than a transport failure.
 *
 * `schema` is a plain `ZodRawShape` rather than a generic. Nothing here needs
 * per-tool argument types: every handler validates through zod at the boundary
 * and reads its arguments by name, so the generic would only buy type inference
 * that is immediately discarded, at the cost of the SDK's conditional callback
 * type becoming unresolvable.
 */
export function register(server: McpServer, def: ToolDef, ctx: ToolContext): void {
  server.registerTool(
    def.name,
    {
      title: def.name,
      description: def.description,
      inputSchema: def.schema,
      annotations: { ...READ_ANNOTATIONS, title: def.name },
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        return ok(await def.handler(args, ctx));
      } catch (error) {
        return fail(error);
      }
    },
  );
}

/**
 * The note attached to any result built from a capped pull.
 *
 * A truncated result that does not say so turns every rate computed from it
 * into a quiet lie, so this is not decoration.
 */
export function truncationNote(
  truncated: boolean,
  stoppedBy: string | undefined,
  rows: number,
): string | undefined {
  if (!truncated) return undefined;
  return stoppedBy === "maxRows"
    ? `Stopped at the ${rows}-row cap before the window was covered, so these figures describe a sample rather than the whole window. Narrow the window, or raise OP3_MAX_ROWS.`
    : `Stopped at the page cap after ${rows} rows before the window was covered, so these figures describe a sample rather than the whole window. Narrow the window, or raise OP3_MAX_PAGES.`;
}
