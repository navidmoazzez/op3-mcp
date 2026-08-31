#!/usr/bin/env bash
# Install op3-mcp into Claude Code.
#
# Everything here can be done by hand in one `claude mcp add`. This exists so
# somebody can paste one line and be finished.
set -euo pipefail

PACKAGE="@thenavidm/op3-mcp@latest"
NAME="op3"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. op3-mcp needs Node 20 or newer: https://nodejs.org" >&2
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node $MAJOR is too old. op3-mcp needs 20 or newer." >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "The claude CLI was not found. Add the server manually, see the README." >&2
  exit 1
fi

# The token is optional: without it the server falls back to OP3's shared
# preview token, so the install works with no account at all.
if [ -n "${OP3_TOKEN:-}" ]; then
  claude mcp add "$NAME" --scope user -e "OP3_TOKEN=$OP3_TOKEN" -- npx -y "$PACKAGE"
  echo "Installed with your OP3 token."
else
  claude mcp add "$NAME" --scope user -- npx -y "$PACKAGE"
  echo "Installed using OP3's shared preview token."
  echo "It is rate limited. Get your own at https://op3.dev/api/keys and re-run"
  echo "this with OP3_TOKEN set."
fi

echo
echo "Checking it worked:"
npx -y "$PACKAGE" doctor || true
