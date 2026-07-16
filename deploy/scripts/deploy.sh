#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DESPLIEGUE en el VPS: git pull → build → migraciones → up -d → verificación.
# Idempotente y seguro con los datos (jamás toca volúmenes).
#
# Uso (en el servidor):
#   cd ~/preztia && ./deploy/scripts/deploy.sh            # despliegue completo
#   ./deploy/scripts/deploy.sh --no-build                 # solo pull + up (config/landing)
#   ./deploy/scripts/deploy.sh --no-pull                  # sin git pull (ya hiciste pull)
#   ./deploy/scripts/deploy.sh --no-migrate               # sin migraciones
#
# La app web (app.DOMAIN) NO se construye aquí: se publica desde tu máquina con
# deploy/scripts/publish-web.sh (el export de Expo necesita las deps de mobile).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_DIR/.env.prod"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml")

DO_PULL=1 DO_BUILD=1 DO_MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --no-pull)    DO_PULL=0 ;;
    --no-build)   DO_BUILD=0 ;;
    --no-migrate) DO_MIGRATE=0 ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $arg (usa --help)"; exit 1 ;;
  esac
done

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*"; exit 1; }
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

[ -f "$ENV_FILE" ] || fail "falta .env.prod (corre primero deploy/scripts/install.sh)"
cd "$REPO_DIR"

# ── 1. Código ────────────────────────────────────────────────────────────────
if [ "$DO_PULL" = 1 ]; then
  echo "── git pull ──"
  # Un árbol sucio en el servidor casi siempre es un error (aquí no se edita código).
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git status --short
    fail "hay cambios locales en el servidor; revísalos (git stash / checkout) y reintenta"
  fi
  git pull --ff-only
  ok "código en $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
fi

# ── 2. Build de la API (usa caché; solo recompila lo que cambió) ────────────
if [ "$DO_BUILD" = 1 ]; then
  echo "── build api ──"
  "${COMPOSE[@]}" build api
fi

# ── 3. Migraciones (one-shot; corta el deploy si fallan) ────────────────────
if [ "$DO_MIGRATE" = 1 ]; then
  echo "── migraciones ──"
  "${COMPOSE[@]}" --profile migrate run --rm migrate
fi

# ── 4. Levantar/recrear SOLO lo que cambió (imagen o .env.prod) ─────────────
echo "── up -d ──"
"${COMPOSE[@]}" up -d --remove-orphans

# ── 5. Verificación: API healthy + respuestas HTTP por Caddy ────────────────
echo "── verificación ──"
api_id="$("${COMPOSE[@]}" ps -q api)"
for _ in $(seq 1 40); do
  st="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_id" 2>/dev/null || echo starting)"
  [ "$st" = "healthy" ] && break
  sleep 3
done
[ "${st:-}" = "healthy" ] || { "${COMPOSE[@]}" logs api --tail 30; fail "la API no llegó a 'healthy'"; }
ok "API healthy"

DOMAIN="$(get_env DOMAIN)"
for host in "$DOMAIN" "api.$DOMAIN" "app.$DOMAIN"; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $host" http://localhost/ || echo 000)"
  # Caddy redirige HTTP→HTTPS (308) cuando el sitio está bien configurado.
  case "$code" in
    200|301|308) ok "$host → HTTP $code" ;;
    *)           printf '\033[33m⚠ %s → HTTP %s (revisa ./deploy/scripts/logs.sh caddy)\033[0m\n' "$host" "$code" ;;
  esac
done

# Limpieza de imágenes huérfanas de builds anteriores (no toca volúmenes ni datos).
docker image prune -f >/dev/null && ok "imágenes viejas depuradas"

"${COMPOSE[@]}" ps
ok "Despliegue terminado."
