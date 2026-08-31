/**
 * What is actually wrong.
 *
 * An MCP client reports every failure as "the tool errored", so without this
 * command a user has no way to tell a bad token from a network problem from a
 * podcast that was never prefixed. Each check below is a failure that presents
 * identically from inside a client and needs a different fix.
 */

import { OP3Client } from "./api/client.js";
import { loadConfig, PREVIEW_TOKEN } from "./config.js";
import { OP3Error } from "./api/errors.js";
import { TOOL_COUNT } from "./tools/index.js";
import { VERSION } from "./server.js";

type Check = { name: string; ok: boolean; detail: string };

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  const client = new OP3Client(config);
  const checks: Check[] = [];

  out(`op3-mcp ${VERSION}`);
  out(`${TOOL_COUNT} tools, all read-only`);
  out("");

  checks.push({
    name: "Node version",
    ok: Number(process.versions.node.split(".")[0]) >= 20,
    detail: `${process.version}, needs 20 or newer`,
  });

  checks.push({
    name: "Token configured",
    ok: !config.usingPreviewToken,
    detail: config.usingPreviewToken
      ? `Using OP3's shared preview token "${PREVIEW_TOKEN}". It works for trying things out but it is shared, rate limited, and can be withdrawn. Create your own at https://op3.dev/api/keys and set OP3_TOKEN.`
      : `OP3_TOKEN is set (${config.token.slice(0, 4)}...${config.token.slice(-2)})`,
  });

  // The only check that proves the credential works. Chosen because it is the
  // cheapest authenticated call OP3 offers: no show, no window, no scan.
  try {
    const started = Date.now();
    const apps = await client.getTopApps();
    const count = Object.keys(apps.appShares ?? {}).length;
    checks.push({
      name: "OP3 API reachable and token accepted",
      ok: count > 0,
      detail:
        count > 0
          ? `Yes, ${count} apps returned in ${Date.now() - started}ms`
          : "Reached OP3 but it returned no data, which is unexpected",
    });
  } catch (error) {
    const message =
      error instanceof OP3Error ? error.message : ((error as Error)?.message ?? String(error));
    checks.push({ name: "OP3 API reachable and token accepted", ok: false, detail: message });
  }

  // The firehose is a separate check because it can fail on its own: it is a
  // scan, and a deadline that is fine for the rolled-up endpoints can be too
  // short for it.
  try {
    const started = Date.now();
    const hits = await client.getHitsPage({ start: "-1h", limit: 1 });
    checks.push({
      name: "Raw query endpoints working",
      ok: true,
      detail: `Yes, ${(hits.rows ?? []).length} row in ${Date.now() - started}ms. These are scans and are far slower than the rolled-up queries.`,
    });
  } catch (error) {
    const message =
      error instanceof OP3Error ? error.message : ((error as Error)?.message ?? String(error));
    checks.push({
      name: "Raw query endpoints working",
      ok: false,
      detail: `${message} The audience, geography, app and trend tools all depend on this; the rolled-up download tools do not.`,
    });
  }

  for (const check of checks) {
    const label = check.ok ? "ok  " : check.name === "Token configured" ? "note" : "FAIL";
    out(`${label}  ${check.name}`);
    out(`      ${check.detail}`);
  }

  out("");
  out("Settings");
  out(`  base url            ${config.baseUrl}`);
  out(`  request timeout     ${config.requestTimeoutMs}ms`);
  out(`  request spacing     ${config.minRequestIntervalMs}ms`);
  out(`  max rows per query  ${config.maxRows}`);
  out(`  max pages per query ${config.maxPages}`);
  out(`  cache ttl           ${config.cacheTtlMs}ms`);
  out("");

  const failed = checks.filter((c) => !c.ok);

  // The preview-token warning is a nudge, not a fault. The server is fully
  // usable without a personal token, so it must neither be counted as a problem
  // nor make doctor exit non-zero and fail somebody's CI.
  const problems = failed.filter((c) => c.name !== "Token configured");
  const nudges = failed.length - problems.length;

  if (problems.length === 0) {
    out(
      nudges > 0
        ? "Everything works. The token note above is a suggestion, not a failure."
        : "Everything checks out.",
    );
    return 0;
  }

  out(`${problems.length} problem${problems.length === 1 ? "" : "s"} found.`);
  return 1;
}
