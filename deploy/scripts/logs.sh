#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DIAGNÓSTICO Y LOGS del stack de producción.
#
# Uso (en el servidor):
#   ./deploy/scripts/logs.sh                    # informe completo: estado, recursos y errores
#   ./deploy/scripts/logs.sh api                # últimas líneas de un servicio
#   ./deploy/scripts/logs.sh -f api             # seguir logs en vivo (Ctrl+C para salir)
#   ./deploy/scripts/logs.sh --errors           # solo errores de todos los servicios
#   ./deploy/scripts/logs.sh --wa               # diagnóstico del webhook de WhatsApp
#   ./deploy/scripts/logs.sh --since 6h         # ventana de tiempo (def. 2h; ej. 30m, 24h)
#   ./deploy/scripts/logs.sh -n 200 api         # cuántas líneas (def. 80)
#
# Los logs de la API son JSON estructurado: para rastrear una petición fallida
# busca su `correlationId` (la app lo muestra en los errores):
#   ./deploy/scripts/logs.sh api | grep <correlationId>
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml")

# Patrones de anomalía: errores de app, BD, TLS/ACME, permisos y saturación.
ERR_RE='error|fatal|panic|exception|traceback|unauthorized|forbidden|denied|refused|failed|timeout|too many|out of memory|oom|28P01|no valid A records|rate.?limit'
SERVICES_ALL=(postgres redis minio api caddy)

SINCE="2h" LINES=80 FOLLOW=0 ONLY_ERRORS=0 ONLY_WA=0
TARGETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--follow)  FOLLOW=1 ;;
    --errors)     ONLY_ERRORS=1 ;;
    --wa)         ONLY_WA=1 ;;
    --since)      SINCE="$2"; shift ;;
    -n|--lines)   LINES="$2"; shift ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)           echo "Opción desconocida: $1 (usa --help)"; exit 1 ;;
    *)            TARGETS+=("$1") ;;
  esac
  shift
done

title() { printf '\n\033[1;36m══ %s ══\033[0m\n' "$*"; }

# ── Modo seguimiento en vivo ─────────────────────────────────────────────────
if [ "$FOLLOW" = 1 ]; then
  exec "${COMPOSE[@]}" logs -f -t --tail "$LINES" ${TARGETS[@]+"${TARGETS[@]}"}
fi

# ── Modo WhatsApp: sigue la cadena llegada → firma → proceso → respuesta ─────
# Responde en orden las 3 preguntas del diagnóstico:
#   1. ¿Meta está llamando al webhook?      → access log de Caddy (hits + status)
#   2. ¿Qué hizo la API con cada mensaje?   → logs de los contextos WhatsApp/Conversations
#   3. ¿Se registró y respondió?            → transcript IN/OUT en conversation_message
if [ "$ONLY_WA" = 1 ]; then
  title "1 · LLEGADA — hits a /webhooks/whatsapp según Caddy (últimas ${SINCE})"
  HITS="$("${COMPOSE[@]}" logs -t --since "$SINCE" caddy 2>&1 \
    | grep -F '"uri":"/webhooks/whatsapp' \
    | sed -E 's/^[^|]*\| ([0-9T:.-]+Z?).*"method":"([A-Z]+)".*"status":([0-9]+).*/  \1  \2 → HTTP \3/' \
    | tail -n "$LINES")"
  if [ -n "$HITS" ]; then echo "$HITS"; else
    echo "  (ni un hit → Meta NO está llamando: ¿app publicada/en producción?"
    echo "   ¿webhook verificado y campo 'messages' suscrito? ¿URL correcta?)"
  fi

  title "2 · PIPELINE — logs de la API (WhatsApp/Conversations) (últimas ${SINCE})"
  "${COMPOSE[@]}" logs -t --since "$SINCE" api 2>&1 \
    | grep -iE 'whatsapp|webhook|conversations|firma|canal |verify' \
    | tail -n "$LINES" || echo "  (nada: o no llegan webhooks, o mira la sección 1)"

  title "3 · TRANSCRIPT — últimos mensajes en BD (IN debe tener su OUT)"
  "${COMPOSE[@]}" exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "
      SELECT to_char(created_at, '"'"'MM-DD HH24:MI:SS'"'"') AS hora, direction, kind,
             left(coalesce(body, '"'"'(media)'"'"'), 60) AS texto
      FROM conversation_message ORDER BY created_at DESC LIMIT 14;"' \
    2>/dev/null || echo "  (no se pudo consultar la BD)"
  exit 0
fi

# ── Modo solo-errores ────────────────────────────────────────────────────────
if [ "$ONLY_ERRORS" = 1 ]; then
  ERR_TARGETS=("${SERVICES_ALL[@]}")
  [ "${#TARGETS[@]}" -gt 0 ] && ERR_TARGETS=("${TARGETS[@]}")
  for s in "${ERR_TARGETS[@]}"; do
    title "ERRORES · $s (últimas ${SINCE})"
    "${COMPOSE[@]}" logs -t --since "$SINCE" "$s" 2>&1 \
      | grep -iE "$ERR_RE" | tail -n "$LINES" || echo "  (sin anomalías)"
  done
  exit 0
fi

# ── Un servicio concreto: tail simple ────────────────────────────────────────
if [ "${#TARGETS[@]}" -gt 0 ]; then
  exec "${COMPOSE[@]}" logs -t --tail "$LINES" "${TARGETS[@]}"
fi

# ── Informe completo (sin argumentos) ────────────────────────────────────────
title "ESTADO DE CONTENEDORES"
"${COMPOSE[@]}" ps

title "SALUD (healthchecks)"
for s in "${SERVICES_ALL[@]}"; do
  id="$("${COMPOSE[@]}" ps -q "$s" 2>/dev/null || true)"
  if [ -z "$id" ]; then printf '  %-10s ✖ no está corriendo\n' "$s"; continue; fi
  st="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
  up="$(docker inspect --format '{{.State.StartedAt}}' "$id" | cut -dT -f1,2 | tr T ' ' | cut -d. -f1)"
  restarts="$(docker inspect --format '{{.RestartCount}}' "$id")"
  printf '  %-10s %-10s desde %s · reinicios: %s\n' "$s" "$st" "$up" "$restarts"
done

title "RECURSOS DEL SERVIDOR"
df -h / | tail -1 | awk '{print "  Disco raíz:  usado "$3" de "$2"  ("$5")"}'
free -h 2>/dev/null | awk '/^Mem/ {print "  Memoria:     usada "$3" de "$2}'
uptime | sed 's/^/  Carga:      /'

title "RECURSOS POR CONTENEDOR"
docker stats --no-stream --format '  {{.Name}}\tCPU {{.CPUPerc}}\tMEM {{.MemUsage}}' \
  | column -t -s $'\t'

title "USO DE DISCO DE DOCKER (imágenes/volúmenes)"
docker system df

title "CERTIFICADOS TLS (eventos ACME recientes de Caddy)"
"${COMPOSE[@]}" logs --since 48h caddy 2>&1 \
  | grep -iE 'certificate obtained|obtain|acme|expir' | tail -12 || echo "  (nada reciente)"

for s in "${SERVICES_ALL[@]}"; do
  title "ANOMALÍAS · $s (últimas ${SINCE})"
  "${COMPOSE[@]}" logs -t --since "$SINCE" "$s" 2>&1 \
    | grep -iE "$ERR_RE" | tail -n 15 || echo "  (sin anomalías)"
done

printf '\n\033[2mTip: sigue un servicio en vivo con  ./deploy/scripts/logs.sh -f api\033[0m\n'
