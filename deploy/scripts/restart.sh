#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# REINICIO de servicios SIN afectar datos (volúmenes intactos; jamás `down -v`).
#
# Uso (en el servidor):
#   ./deploy/scripts/restart.sh                # reinicia TODOS los servicios
#   ./deploy/scripts/restart.sh api caddy      # solo esos servicios
#   ./deploy/scripts/restart.sh --hard         # RECREA contenedores (up -d --force-recreate)
#
# ⚠ `restart` NO relee .env.prod (reutiliza el contenedor). Si cambiaste
#   variables de entorno usa --hard, que recrea los contenedores; los datos
#   viven en volúmenes con nombre (pgdata_prod, redisdata_prod, miniodata_prod,
#   caddy_data) y NO se tocan al recrear.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml")

HARD=0
SERVICES=()
for arg in "$@"; do
  case "$arg" in
    --hard)    HARD=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "Opción desconocida: $arg (usa --help)"; exit 1 ;;
    *)         SERVICES+=("$arg") ;;
  esac
done

if [ "$HARD" = 1 ]; then
  echo "── Recreando contenedores (relee .env.prod; volúmenes intactos) ──"
  "${COMPOSE[@]}" up -d --force-recreate --remove-orphans ${SERVICES[@]+"${SERVICES[@]}"}
else
  echo "── Reiniciando servicios (rápido; NO relee .env.prod) ──"
  "${COMPOSE[@]}" restart ${SERVICES[@]+"${SERVICES[@]}"}
fi

echo
"${COMPOSE[@]}" ps
printf '\033[32m✔ Listo. Datos intactos (volúmenes con nombre no se tocaron).\033[0m\n'
