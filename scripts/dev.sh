#!/usr/bin/env bash
# Start infrastructure (if needed) and launch the native Electron app in development mode.
source "$(dirname "$0")/lib.sh"
# No Docker, no database server, no .env: uTerm keeps its data in a local SQLite file and runs speech recognition inside the app,
# exactly like the installed app. (A Chatterbox server is optional: see docker-compose.yml.)

cd desktop
[ -d node_modules ] || { c_info "Installing desktop dependencies"; npm install --no-audit --no-fund; }
flag="$(sandbox_flag)"
[ -z "$flag" ] || c_warn "Electron SUID sandbox not configured → running with --no-sandbox (dev only; see ./scripts/setup.sh)"
export ECHO_TERM_ROOT="$ROOT"
# On a Wayland session the window icon (BrowserWindow "icon") is ignored: Wayland takes it from an installed .desktop file,
# which only exists for packaged builds. Running through XWayland in dev makes the cat icon show up.
# Set ECHO_TERM_DEV_WAYLAND=1 to stay on native Wayland (generic icon).
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && [ -z "${ECHO_TERM_DEV_WAYLAND:-}" ]; then
  flag="$flag --ozone-platform=x11"
  c_info "Wayland session: using XWayland in dev so the app icon is shown (ECHO_TERM_DEV_WAYLAND=1 to disable)"
fi
# GNOME (and most Linux docks) take the dock / Alt+Tab icon from a .desktop file that matches the window class ("uterm"), not from the
# window itself, so a dev run shows the generic gear. Install a user-level launcher and icon (kept in the icon theme, which the shell
# refreshes, unlike a bare file path that it caches). Harmless and easy to remove; refreshed whenever the icon changes.
if [ "$(uname -s)" = "Linux" ]; then
  data="${XDG_DATA_HOME:-$HOME/.local/share}"; apps="$data/applications"; desk="$apps/uterm-dev.desktop"; theme="$data/icons/hicolor"
  name="uterm-$(cksum < "$ROOT/desktop/build/icon.png" | cut -d' ' -f1)" # a new name whenever the artwork changes: the shell caches icons by name
  want="[Desktop Entry]
Type=Application
Name=uTerm (dev)
Comment=uTerm development build
Exec=$ROOT/scripts/dev.sh
Icon=$name
Terminal=false
Categories=Development;
StartupWMClass=uterm"
  changed=0
  for pair in "512:icon.png" "192:icon-window.png"; do
    size="${pair%%:*}"; src="$ROOT/desktop/build/${pair#*:}"; dst="$theme/${size}x${size}/apps/$name.png"
    if ! cmp -s "$src" "$dst" 2>/dev/null; then mkdir -p "$(dirname "$dst")" && cp "$src" "$dst" && changed=1; fi
  done
  for old in "$theme"/*/apps/uterm.png "$theme"/*/apps/uterm-[0-9]*.png; do # older artwork
    [ -e "$old" ] && [ "$(basename "$old")" != "$name.png" ] && rm -f "$old" && changed=1
  done
  if [ "$(cat "$desk" 2>/dev/null)" != "$want" ]; then mkdir -p "$apps" && printf '%s\n' "$want" > "$desk" && changed=1; fi
  if [ "$changed" = 1 ]; then
    command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -f -t "$theme" 2>/dev/null || true
    command -v update-desktop-database >/dev/null && update-desktop-database "$apps" 2>/dev/null || true
    c_info "Installed the uTerm launcher icon for the dock (if it still shows the old one, log out and in once)"
  fi
fi
# electron-vite forwards arguments after -- to Electron
exec npx electron-vite dev -- $flag
