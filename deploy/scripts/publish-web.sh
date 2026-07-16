#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PUBLICAR LA APP WEB (app.DOMAIN) — se ejecuta EN TU MÁQUINA LOCAL, no en el VPS.
#
# Exporta apps/mobile a web estática (Expo) con la URL de la API de producción
# horneada en el build, y sube el resultado a deploy/app/ del servidor, de donde
# Caddy lo sirve directamente (no hace falta reiniciar nada).
#
# Uso:
#   ./deploy/scripts/publish-web.sh                       # build + subida
#   DEPLOY_HOST=deploy@1.2.3.4 ./deploy/scripts/publish-web.sh   # otro servidor
#   API_URL=https://api.otro.co ./deploy/scripts/publish-web.sh  # otra API
#
# ⚠ EXPO_PUBLIC_API_URL queda fija en el bundle: si cambia la URL de la API hay
#   que volver a ejecutar este script (rebuild + subida).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-deploy@62.84.181.41}"
REMOTE_DIR="${REMOTE_DIR:-~/preztia/deploy/app}"
API_URL="${API_URL:-https://api.preztia.co}"

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*"; exit 1; }

echo "── Export web de Expo (API: $API_URL) ──"
cd "$REPO_DIR/apps/mobile"
EXPO_PUBLIC_API_URL="$API_URL" npx expo export --platform web
[ -f dist/index.html ] || fail "el export no generó dist/index.html"
ok "build en apps/mobile/dist ($(du -sh dist | cut -f1))"

echo "── Subiendo a $DEPLOY_HOST:$REMOTE_DIR ──"
# tar sobre ssh: funciona aunque el servidor no tenga rsync; --delete implícito
# porque vaciamos el destino antes (los archivos de Expo van hasheados).
ssh "$DEPLOY_HOST" "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"
tar -czf - -C dist . | ssh "$DEPLOY_HOST" "tar -xzf - -C $REMOTE_DIR"
ssh "$DEPLOY_HOST" "test -f $REMOTE_DIR/index.html" || fail "la subida no dejó index.html en el servidor"
ok "app publicada (Caddy la sirve al instante, sin reinicios)"
