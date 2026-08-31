#!/usr/bin/env node
/**
 * Is npm behind the repo?
 *
 * npm serves the README from the tarball that was published, frozen at that
 * moment. GitHub serves the current commit. So the two drift silently every
 * time a README change is pushed without a republish, and nothing anywhere
 * tells you: the package page just quietly keeps showing the old instructions.
 *
 * This compares the published tarball against the working tree and says which
 * one is stale. Run it before and after publishing.
 *
 *   npm run check:published
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const { name, version } = pkg;

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

let published;
try {
  published = run("npm", ["view", name, "version"]);
} catch {
  console.log(`${name} is not published yet. Local version is ${version}.`);
  process.exit(1);
}

console.log(`local:     ${version}`);
console.log(`published: ${published}`);

if (published !== version) {
  console.log(`\nOut of step. Users on @latest are getting ${published}, this repo is ${version}.`);
  process.exit(1);
}

// Same version number, so the README should be byte-identical. If it is not,
// someone edited the README and pushed to GitHub without republishing, which is
// exactly the failure this script exists to catch.
const dir = mkdtempSync(join(tmpdir(), "pubcheck-"));
run("npm", ["pack", `${name}@${published}`], { cwd: dir });
const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
run("tar", ["xzf", join(dir, tgz), "-C", dir]);

const publishedReadme = join(dir, "package", "README.md");
if (!existsSync(publishedReadme)) {
  console.log("\nThe published tarball has no README. Check the files field in package.json.");
  process.exit(1);
}

const onNpm = readFileSync(publishedReadme, "utf8");
const inRepo = readFileSync(new URL("../README.md", import.meta.url), "utf8");

if (onNpm === inRepo) {
  console.log("\nREADME on npm matches this repo.");
  process.exit(0);
}

console.log(
  "\nREADME on npm does NOT match this repo, at the same version number.\n" +
    "The package page is showing older text than GitHub. npm refuses to\n" +
    "overwrite a published version, so the fix is to bump and publish again.",
);
process.exit(1);
