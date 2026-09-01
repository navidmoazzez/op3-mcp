#!/usr/bin/env node
/**
 * Entry point.
 *
 * `op3-mcp`          stdio, which is what an MCP client launches
 * `op3-mcp --http`   HTTP, for running it somewhere always on
 * `op3-mcp doctor`   check the setup and say what is actually wrong
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { loadConfig } from "./config.js";
import { httpOptionsFromEnv, startHttpServer } from "./transport/http.js";

const HELP = `op3-mcp ${VERSION}

Podcast analytics from OP3, the Open Podcast Prefix Project. 22 tools, all read-only.

  op3-mcp                     Run over stdio. This is what an MCP client launches.
  op3-mcp --http [--port=N]   Run over HTTP, for a machine that is always on.
  op3-mcp doctor              Check the setup and report what is wrong.
  op3-mcp --version           Print the version.

Credentials:
  OP3_TOKEN                   Bearer token from https://op3.dev/api/keys
                              Optional. Without it the server uses OP3's shared
                              preview token, which works but is rate limited.

Options:
  OP3_REQUEST_TIMEOUT_MS      per-request deadline, default 45000
  OP3_MIN_REQUEST_INTERVAL_MS spacing between requests, default 150
  OP3_MAX_ROWS                cap on rows any one analysis pulls, default 50000
  OP3_MAX_PAGES               cap on continuation pages, default 40
  OP3_CACHE_TTL_MS            response cache lifetime, default 300000, 0 disables
  OP3_HTTP_PORT / _HOST / _TOKEN   for --http

https://github.com/navidmoazzez/op3-mcp
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "doctor") {
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor();
    return;
  }

  const config = loadConfig();
  const built = buildServer(config);

  // Warn, never block. A network check at startup would delay the handshake,
  // and the preview token works, so this is a nudge rather than a fault.
  if (config.usingPreviewToken) {
    process.stderr.write(
      "[op3-mcp] No OP3_TOKEN set, using OP3's shared preview token. It is rate limited and can be withdrawn. Get your own at https://op3.dev/api/keys\n",
    );
  }

  const shutdown = async (close?: () => Promise<void>): Promise<void> => {
    if (close) await close().catch(() => undefined);
    process.exit(0);
  };

  if (argv.includes("--http")) {
    const { close } = await startHttpServer(built, httpOptionsFromEnv(argv));
    process.on("SIGTERM", () => void shutdown(close));
    process.on("SIGINT", () => void shutdown(close));
    return;
  }

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // Handled so `docker stop` and a client shutting down return promptly rather
  // than waiting out a grace period.
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[op3-mcp] ${(error as Error).message}\n`);
  process.exit(1);
});
