#!/usr/bin/env bash
#
# Instala Latido en el escritorio de Linux: binario, icono y lanzador.
#
#   ./scripts/install-desktop.sh                 compila y lo instala para el usuario
#   ./scripts/install-desktop.sh --binary RUTA   instala un binario ya compilado
#   ./scripts/install-desktop.sh --icono         solo refresca icono y lanzador
#
# Todo va al perfil del usuario (~/.local): no hace falta root y se desinstala
# borrando tres archivos, que es lo que se documenta al final.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT

APPS_DIR="$HOME/.local/share/applications"
BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
BINARY=""
ONLY_ICON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --binary) BINARY="${2:-}"; shift 2 ;;
    --icono|--icon) ONLY_ICON=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1m›\033[0m %s\n' "$1"; }

install_icons() {
  log "Instalando iconos"
  for size in 32 64 128 256 512; do
    local source="$ROOT/apps/desktop/src-tauri/icons/${size}x${size}.png"
    [ -f "$source" ] || continue
    install -Dm644 "$source" "$ICON_DIR/${size}x${size}/apps/latido.png"
  done
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -qtf "$ICON_DIR" >/dev/null 2>&1 || true
  fi
}

install_launcher() {
  log "Instalando lanzador"
  install -Dm644 "$ROOT/apps/desktop/latido.desktop" "$APPS_DIR/latido.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q "$APPS_DIR" >/dev/null 2>&1 || true
  fi
  # Copia en el escritorio, para poder abrirlo con doble clic.
  if [ -d "$DESKTOP_DIR" ]; then
    install -m755 "$ROOT/apps/desktop/latido.desktop" "$DESKTOP_DIR/latido.desktop"
    if command -v gio >/dev/null 2>&1; then
      gio set "$DESKTOP_DIR/latido.desktop" metadata::trusted true >/dev/null 2>&1 || true
    fi
  fi
}

if [ "$ONLY_ICON" -eq 0 ]; then
  if [ -z "$BINARY" ]; then
    log "Compilando (esto tarda la primera vez)"
    (cd "$ROOT" && pnpm build >/dev/null && pnpm --filter @latido/desktop exec tauri build --no-bundle)
    BINARY="$ROOT/apps/desktop/src-tauri/target/release/latido"
  fi
  [ -x "$BINARY" ] || { echo "no encuentro el binario: $BINARY" >&2; exit 1; }
  log "Instalando binario en $BIN_DIR/latido"
  install -Dm755 "$BINARY" "$BIN_DIR/latido"
fi

install_icons
install_launcher

if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
  log "Aviso: $BIN_DIR no está en el PATH. Añádelo para poder lanzar 'latido' desde la terminal."
fi

cat <<TXT

Listo. Abre Latido desde el menú de aplicaciones (busca "Latido") o con doble
clic en el icono del escritorio.

  Lanzador   $APPS_DIR/latido.desktop
  Iconos     $ICON_DIR/*/apps/latido.png
  Binario    $BIN_DIR/latido

Desinstalar:

  rm -f "$APPS_DIR/latido.desktop" "$BIN_DIR/latido" "$DESKTOP_DIR/latido.desktop"
  rm -rf "\${XDG_DATA_HOME:-\$HOME/.local/share}/app.latido.desktop"

Tus datos (publicaciones, temas, avisos) viven en el directorio de datos de la
aplicación; borrarlo es lo que los elimina de verdad.
TXT
