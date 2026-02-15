#!/usr/bin/env bash
# Install flow: download → launcher + PATH → setup (deps, config, WhatsApp link, bot runs).
# New shell is created only after setup.js exits (user presses Ctrl+C to stop the bot).
# In the new shell nothing runs automatically — user runs 'cowcode' when they want the bot.
set -e
# Optional: run a command in the new shell after install (e.g. -c "cowcode" or -c "which cowcode")
# Usage: curl ... | bash -s -- -c "cowcode"
POST_INSTALL_CMD=
[ "$1" = "-c" ] && [ -n "${2:-}" ] && POST_INSTALL_CMD="$2"

BRANCH="${COWCODE_BRANCH:-master}"
TARBALL="https://github.com/bishwashere/cowCode/archive/refs/heads/${BRANCH}.tar.gz"
EXTRACTED="cowCode-${BRANCH}"
DIR="cowCode"

echo ""
echo "  Welcome to cowCode — WhatsApp bot with your own LLM"
echo "  ------------------------------------------------"
echo ""

if [ -d "$DIR" ]; then
  echo "Directory $DIR already exists. Remove it or use another directory."
  exit 1
fi

echo "  ► Downloading..."
curl -fsSL "$TARBALL" | tar xz
mv "$EXTRACTED" "$DIR"
cd "$DIR"
echo "  ✓ Done."
echo ""

# Install launcher and PATH first so cowcode works even if setup.js fails
INSTALL_DIR="$(pwd)"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/cowcode" << EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR" && exec node cli.js "\$@"
EOF
chmod +x "$BIN_DIR/cowcode"
echo "  ► Launcher installed: $BIN_DIR/cowcode"

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
ADDED_PATH=0
add_path_to() {
  local f="$1"
  [ -f "$f" ] || touch "$f" 2>/dev/null || return 0
  grep -q '.local/bin' "$f" 2>/dev/null && return 0
  echo "" >> "$f"
  echo "# cowCode" >> "$f"
  echo "$PATH_LINE" >> "$f"
  echo "  ► Added ~/.local/bin to PATH in $f"
  ADDED_PATH=1
}
if ! command -v cowcode >/dev/null 2>&1; then
  add_path_to "${ZDOTDIR:-$HOME}/.zshrc"
  add_path_to "${ZDOTDIR:-$HOME}/.zprofile"
  add_path_to "$HOME/.bashrc"
  add_path_to "$HOME/.profile"
  [ "$ADDED_PATH" = 1 ] && echo "  ► Open a new terminal, or run:  source ~/.zshrc   (then run: cowcode)"
fi
echo ""

echo "  ► Setting up (dependencies + config)..."
if [ -n "$POST_INSTALL_CMD" ]; then
  # Non-interactive: just install deps so cowcode can run when we exec with -c
  (cd "$INSTALL_DIR" && (pnpm install --silent 2>/dev/null || npm install --silent 2>/dev/null || true))
  echo "  ✓ Dependencies ready."
else
  echo "  (You will link WhatsApp in a moment. When you are done and want to stop the bot, press Ctrl+C.)"
  echo ""
  # Ignore Ctrl+C in this script so we always reach the exec (new shell) after setup exits
  trap '' INT
  if [ -t 0 ]; then
    node setup.js || true
  elif [ -e /dev/tty ]; then
    node setup.js < /dev/tty || true
  else
    echo "  No terminal. Run: cd $DIR && node setup.js"
  fi
  trap - INT
  echo ""
  echo "  ------------------------------------------------"
  echo "  To start the bot:  cowcode"
  echo "  (or from this folder:  npm start)"
  echo ""
  # New shell is created only after setup.js exits (e.g. after user presses Ctrl+C).
  # Nothing runs automatically in the new shell — user runs 'cowcode' when they want the bot.
  if [ "$ADDED_PATH" = 1 ] && [ -t 0 ]; then
    echo "  ► Opening a new shell so  cowcode  works there. Run  cowcode  when you want to start the bot."
    exec "${SHELL:-/bin/zsh}" -l
  fi
  exit 0
fi
echo ""
echo "  ------------------------------------------------"
echo "  To start the bot:  cowcode"
echo "  (or from this folder:  npm start)"
echo ""

# When -c was passed: run that command in the new shell and exit
if [ -n "$POST_INSTALL_CMD" ]; then
  echo "  ► Running in new shell: $POST_INSTALL_CMD"
  exec "${SHELL:-/bin/zsh}" -l -c "$POST_INSTALL_CMD"
elif [ "$ADDED_PATH" = 1 ] && [ -t 0 ]; then
  echo "  ► Starting a new shell so  cowcode  works in this terminal..."
  exec "${SHELL:-/bin/zsh}" -l
fi
