#!/usr/bin/env bash
#
# Verificación completa de Latido. Es lo que ejecuta el CI, paso a paso, y lo que
# debería correr cualquiera antes de abrir un pull request.
#
#   pnpm verify
#
# Falla en cuanto algo no está bien: tipos, tests, compilación o determinismo.

set -euo pipefail

cd "$(dirname "$0")/.."
readonly ROOT="$PWD"

step() {
  printf '\n\033[1m── %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2
  exit 1
}

command -v pnpm >/dev/null 2>&1 || fail "falta pnpm"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 20 || (major === 20 && minor < 19)) { console.error(`Node ${process.versions.node} es demasiado antiguo; se necesita ≥ 20.19`); process.exit(1) }'

step "Dependencias"
pnpm install --frozen-lockfile

step "Tokens de diseño"
pnpm --filter @latido/tokens build

step "Los tokens son deterministas"
readonly TEMP_DIR="$(mktemp -d)"
cp packages/tokens/dist/tokens.css "$TEMP_DIR/tokens.css"
cp packages/tokens/dist/tokens.json "$TEMP_DIR/tokens.json"
pnpm --filter @latido/tokens build >/dev/null
diff -q "$TEMP_DIR/tokens.css" packages/tokens/dist/tokens.css >/dev/null \
  || fail "tokens.css cambia entre dos compilaciones idénticas"
diff -q "$TEMP_DIR/tokens.json" packages/tokens/dist/tokens.json >/dev/null \
  || fail "tokens.json cambia entre dos compilaciones idénticas"
rm -rf "$TEMP_DIR"

step "Tipos"
pnpm -r typecheck

step "Tests del motor"
pnpm --filter @latido/engine test

step "Compilar la interfaz"
pnpm --filter @latido/app build

if [ -f apps/desktop/src-tauri/Cargo.toml ] && command -v cargo >/dev/null 2>&1; then
  step "Escritorio (Rust)"
  (cd apps/desktop/src-tauri && cargo check --locked)
else
  printf '\n(sin cargo o sin shell de escritorio: se omite la comprobación de Rust)\n'
fi

step "Comprobaciones de repositorio"
git -C "$ROOT" diff --check >/dev/null || fail "hay espacios en blanco al final de alguna línea"

printf '\n\033[32m✓ Todo en verde\033[0m\n'
