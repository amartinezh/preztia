#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# INSTALACIÓN INICIAL del VPS de producción de PreztiaOS (una sola vez).
#
# Instala Docker + utilidades, valida .env.prod (errores que ya nos mordieron:
# placeholder sin cambiar, password de POSTGRES distinto al de DATABASE_URL),
# construye la imagen, aplica migraciones y levanta el stack completo.
#
# Uso (en el servidor, dentro del repo clonado):
#   cd ~/preztia && ./deploy/scripts/install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_DIR/.env.prod"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml")

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*"; exit 1; }

# Lee una variable de .env.prod sin `source` (los secretos traen $, +, = …).
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# ── 1. Paquetes base ─────────────────────────────────────────────────────────
echo "── Paquetes base (git, curl, rsync) ──"
if command -v apt-get >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq git curl ca-certificates rsync
  ok "utilidades instaladas"
else
  warn "no hay apt-get; instala git/curl/rsync manualmente si faltan"
fi

# ── 2. Docker + compose plugin ───────────────────────────────────────────────
echo "── Docker ──"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  ok "Docker instalado"
else
  ok "Docker ya presente: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || fail "falta el plugin 'docker compose' (v2)"
sudo systemctl enable --now docker >/dev/null 2>&1 || true
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  warn "usuario '$USER' agregado al grupo docker → cierra sesión y vuelve a entrar"
fi

# ── 3. .env.prod ─────────────────────────────────────────────────────────────
echo "── Configuración (.env.prod) ──"
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/env.prod.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  fail ".env.prod no existía: lo creé desde la plantilla. Rellena los secretos (DOMAIN,
   POSTGRES_PASSWORD, DATABASE_URL, JWT_SECRET, CORS_ORIGIN…) y vuelve a ejecutar."
fi

# Validaciones que evitan los fallos que ya vivimos en este despliegue:
grep -q 'CAMBIA_ESTE_SECRETO_FUERTE' "$ENV_FILE" \
  && fail "hay placeholders 'CAMBIA_ESTE_SECRETO_FUERTE' sin reemplazar en .env.prod"

PG_PASS="$(get_env POSTGRES_PASSWORD)"
DB_URL="$(get_env DATABASE_URL)"
case "$DB_URL" in
  *"$PG_PASS"*) ok "DATABASE_URL usa el mismo password que POSTGRES_PASSWORD" ;;
  *) fail "el password de DATABASE_URL NO coincide con POSTGRES_PASSWORD (causa el 28P01 en migraciones)" ;;
esac

DOMAIN="$(get_env DOMAIN)"
[ -n "$DOMAIN" ] || fail "DOMAIN vacío en .env.prod"
ok "dominio: $DOMAIN"

# ── 4. Build + migraciones + arranque ────────────────────────────────────────
echo "── Build de la imagen de la API ──"
"${COMPOSE[@]}" build api

echo "── Migraciones de esquema ──"
"${COMPOSE[@]}" --profile migrate run --rm migrate

echo "── Levantando el stack ──"
"${COMPOSE[@]}" up -d --remove-orphans
"${COMPOSE[@]}" ps

cat <<EOF

$(ok "Instalación completa.")

Pasos siguientes (manuales, una vez):
  1. DNS: registros @ / api (A → IP del VPS) y app / www (CNAME → $DOMAIN).
  2. (Primera vez, ⚠ BORRA TODA LA BD y siembra el tenant demo):
       ${COMPOSE[*]} exec api pnpm --filter api seed:user
  3. App web: desde tu máquina local, ./deploy/scripts/publish-web.sh
  4. Verifica: ./deploy/scripts/logs.sh
EOF
