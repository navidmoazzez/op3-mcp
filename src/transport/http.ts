/**
 * HTTP transport, for running the server somewhere always on.
 *
 * Streamable HTTP, stateless: every request builds its own transport and tears
 * it down. No session map means no session leak, which matters more here than
 * the reconnect support a stateful server would buy.
 *
 * This is what makes claude.ai possible. claude.ai runs a connector from
 * Anthropic's cloud rather than the user's machine, so it cannot launch a local
 * command and needs a public HTTPS URL.
 *
 * Bound to 127.0.0.1 unless asked otherwise. An OP3 token is read-only and low
 * value, but a server that binds 0.0.0.0 without being told to is a habit worth
 * not forming; OP3_HTTP_HOST is there for people who mean it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BuiltServer } from "../server.js";

export type HttpOptions = {
  port: number;
  host: string;
  /** When set, every request must send `Authorization: Bearer <token>`. */
  token?: string;
};

export function httpOptionsFromEnv(argv: string[] = []): HttpOptions {
  const flag = argv.find((a) => a.startsWith("--port="));
  const port = Number(flag?.split("=")[1] ?? process.env.OP3_HTTP_PORT ?? 8787);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    host: process.env.OP3_HTTP_HOST || "127.0.0.1",
    token: process.env.OP3_HTTP_TOKEN || undefined,
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function startHttpServer(
  built: BuiltServer,
  options: HttpOptions,
): Promise<{ close: () => Promise<void> }> {
  const http = createServer((req, res) => {
    void handle(built, options, req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: (error as Error)?.message ?? "internal error" },
          id: null,
        }),
      );
    });
  });

  await new Promise<void>((resolve) => http.listen(options.port, options.host, resolve));
  process.stderr.write(
    `[op3-mcp] listening on http://${options.host}:${options.port}/mcp${options.token ? " (bearer token required)" : ""}\n`,
  );

  return {
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
      }),
  };
}

async function handle(
  built: BuiltServer,
  options: HttpOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        version: built.server.server.getClientVersion()?.version ?? undefined,
        tools: built.toolCount,
        usingPreviewToken: built.config.usingPreviewToken,
      }),
    );
    return;
  }

  if (options.token) {
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${options.token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }

  if (req.method === "DELETE") {
    // Stateless: there is no session to end, and saying so beats a 404.
    res.writeHead(204).end();
    return;
  }

  // A fresh transport per request. `sessionIdGenerator: undefined` is what puts
  // the SDK into stateless mode.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => void transport.close());
  await built.server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}
