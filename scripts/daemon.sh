#!/usr/bin/env bash
# Daemon control: start | stop | status | restart
# Uses COWCODE_INSTALL_DIR (set by cli.js). State dir: ~/.cowcode or COWCODE_STATE_DIR.

set -e
ACTION="${1:?Usage: cowcode moo start|stop|status|restart}"
INSTALL_DIR="${COWCODE_INSTALL_DIR:-.}"
STATE_DIR="${COWCODE_STATE_DIR:-$HOME/.cowcode}"
# Resolve INSTALL_DIR to absolute path
if [ -d "$INSTALL_DIR" ]; then
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
fi
[ -d "$STATE_DIR" ] || mkdir -p "$STATE_DIR"
STATE_DIR="$(cd "$STATE_DIR" && pwd)"
# Pre-create log files so "tail -f daemon.log" works immediately after start; launchd will append
touch "$STATE_DIR/daemon.log" "$STATE_DIR/daemon.err" 2>/dev/null || true
NODE="$(command -v node 2>/dev/null || true)"
[ -z "$NODE" ] && NODE="node"
INDEX_JS="$INSTALL_DIR/index.js"

# macOS launchd
LAUNCHD_LABEL="ai.cowcode.bot"
PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"

# Linux systemd user
SERVICE_NAME="cowcode"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"

ensure_plist() {
  [ -f "$INDEX_JS" ] || { echo "Missing $INDEX_JS. Run from cowCode install directory."; exit 1; }
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${INDEX_JS}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${STATE_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COWCODE_STATE_DIR</key>
    <string>${STATE_DIR}</string>
    <key>COWCODE_INSTALL_DIR</key>
    <string>${INSTALL_DIR}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${STATE_DIR}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${STATE_DIR}/daemon.err</string>
</dict>
</plist>
EOF
  echo "Created $PLIST"
}

ensure_systemd_unit() {
  [ -f "$INDEX_JS" ] || { echo "Missing $INDEX_JS. Run from cowCode install directory."; exit 1; }
  mkdir -p "$SYSTEMD_USER_DIR"
  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=cowCode WhatsApp bot
After=network.target

[Service]
Type=simple
Environment="COWCODE_STATE_DIR=${STATE_DIR}" "COWCODE_INSTALL_DIR=${INSTALL_DIR}"
ExecStart=${NODE} ${INDEX_JS}
WorkingDirectory=${STATE_DIR}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  echo "Created $SERVICE_FILE"
}

case "$(uname -s)" in
  Darwin)
    case "$ACTION" in
      start)
        if [ ! -f "$PLIST" ]; then
          ensure_plist
        fi
        touch "$STATE_DIR/daemon.log" "$STATE_DIR/daemon.err" 2>/dev/null || true
        set +e
        launchctl load "$PLIST"
        load_ret=$?
        set -e
        if [ "$load_ret" -ne 0 ]; then
          if launchctl list 2>/dev/null | grep -q "$LAUNCHD_LABEL"; then
            echo "Daemon is already running. Logs: $STATE_DIR/daemon.log"
          else
            echo "Daemon failed to start. Check the error above."
            exit 1
          fi
        else
          echo "Daemon started. Logs: $STATE_DIR/daemon.log"
        fi
        ;;
      stop)
        launchctl unload "$PLIST" 2>/dev/null || true
        echo "Daemon stopped."
        ;;
      status)
        if launchctl list 2>/dev/null | grep -q "$LAUNCHD_LABEL"; then
          echo "Daemon is running."
          launchctl list "$LAUNCHD_LABEL" 2>/dev/null || true
        else
          echo "Daemon is not running."
        fi
        ;;
      restart)
        launchctl unload "$PLIST" 2>/dev/null || true
        sleep 1
        [ -f "$PLIST" ] || ensure_plist
        launchctl load "$PLIST"
        echo "Daemon restarted."
        ;;
      *) echo "Usage: cowcode moo start|stop|status|restart"; exit 1 ;;
    esac
    ;;
  Linux*)
    case "$ACTION" in
      start)
        if [ ! -f "$SERVICE_FILE" ]; then
          ensure_systemd_unit
        fi
        systemctl --user daemon-reload 2>/dev/null || true
        systemctl --user enable --now "$SERVICE_NAME" 2>/dev/null || systemctl --user start "$SERVICE_NAME"
        echo "Daemon started. Logs: journalctl --user -u $SERVICE_NAME -f"
        ;;
      stop)
        systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
        echo "Daemon stopped."
        ;;
      status)
        systemctl --user status "$SERVICE_NAME" 2>/dev/null || echo "Daemon is not running."
        ;;
      restart)
        [ -f "$SERVICE_FILE" ] || ensure_systemd_unit
        systemctl --user daemon-reload 2>/dev/null || true
        systemctl --user restart "$SERVICE_NAME"
        echo "Daemon restarted."
        ;;
      *) echo "Usage: cowcode moo start|stop|status|restart"; exit 1 ;;
    esac
    ;;
  *)
    echo "Daemon is supported on macOS (launchd) and Linux (systemd). Your OS: $(uname -s)"
    exit 1
    ;;
esac
