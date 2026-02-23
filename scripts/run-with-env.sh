#!/usr/bin/env bash
# Wrapper: load ~/.cowcode/.env into the environment, then start the bot.
# Used by launchd (macOS) and systemd (Linux) so HA_URL, HA_TOKEN, etc. are available.
# COWCODE_STATE_DIR and COWCODE_INSTALL_DIR must be set by the caller.

set -e
STATE_DIR="${COWCODE_STATE_DIR:-$HOME/.cowcode}"
INSTALL_DIR="${COWCODE_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
export COWCODE_STATE_DIR="$STATE_DIR"
export COWCODE_INSTALL_DIR="$INSTALL_DIR"

if [ -f "$STATE_DIR/.env" ]; then
  set -a
  set +e
  . "$STATE_DIR/.env" 2>/dev/null
  set -e
  set +a
fi

NODE="${NODE:-$(command -v node 2>/dev/null || true)}"
[ -z "$NODE" ] && NODE="node"
exec "$NODE" "$INSTALL_DIR/index.js" "$@"
