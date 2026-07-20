#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# upgrade.sh — ACTUALIZA EL VPS DE PRODUCCIÓN (backend + app web) DESDE TU MÁQUINA
#
# Orquesta un despliegue completo, de punta a punta, desde tu portátil:
#
#   1. Sincroniza el código  → hace git push de la rama de producción a GitHub
#                              (el servidor despliega SOLO lo que está en origin).
#   2. Actualiza el BACKEND  → por SSH corre deploy/scripts/deploy.sh en el VPS
#                              (git pull → build → migraciones → up -d → verifica).
#   3. Publica el FRONTEND   → deploy/scripts/publish-web.sh (export web de Expo con
#                              la API de prod horneada → sube a Caddy, sin reinicios).
#   4. Verifica desde fuera  → curl HTTPS a landing, api y app.
#
# El backend va PRIMERO; si falla, la web NO se publica (evita front nuevo contra
# API vieja). Jamás toca volúmenes/datos: build, migraciones y `up -d` son seguros.
#
# ── USO ──────────────────────────────────────────────────────────────────────
#   ./upgrade.sh                 # despliegue completo (back + web) con confirmación
#   ./upgrade.sh -y              # sin preguntar (para CI o cuando ya sabes qué haces)
#   ./upgrade.sh --web-only      # solo re-publica la app web (no toca el backend)
#   ./upgrade.sh --back-only     # solo backend (no re-publica la web)
#   ./upgrade.sh --no-migrate    # backend sin correr migraciones de esquema
#   ./upgrade.sh --no-build      # backend sin recompilar la imagen (solo pull + up)
#   ./upgrade.sh --no-push       # no hace git push (despliega lo que YA está en origin)
#   ./upgrade.sh --allow-dirty   # permite árbol local sucio (NO se despliega lo no commiteado)
#   ./upgrade.sh -h              # esta ayuda
#
# ── CONFIG (variables de entorno, con valores por defecto de producción) ─────
#   DEPLOY_HOST=deploy@62.84.181.41   usuario@host SSH del VPS
#   REMOTE_REPO=~/preztia             ruta del repo en el servidor
#   DOMAIN=preztia.co                 dominio raíz (deriva app./api.)
#   API_URL=https://api.preztia.co    URL de la API horneada en el bundle web
#   DEPLOY_BRANCH=main                rama que el servidor despliega
#
# Requiere: git, ssh, tar, node/npx (para el export de Expo) en tu máquina; y una
# llave SSH válida contra el VPS. Corre en tu MÁQUINA LOCAL, no en el servidor.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuración (overridable por entorno) ──────────────────────────────────
DEPLOY_HOST="${DEPLOY_HOST:-deploy@62.84.181.41}"
REMOTE_REPO="${REMOTE_REPO:-~/preztia}"
DOMAIN="${DOMAIN:-preztia.co}"
API_URL="${API_URL:-https://api.$DOMAIN}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Salida con color ─────────────────────────────────────────────────────────
ok()    { printf '\033[32m✔ %s\033[0m\n' "$*"; }
info()  { printf '\033[36m• %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;35m══ %s ══\033[0m\n' "$*"; }
fail()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Flags ────────────────────────────────────────────────────────────────────
DO_BACK=1 DO_WEB=1 DO_PUSH=1 ALLOW_DIRTY=0 ASSUME_YES=0
SERVER_ARGS=""   # se reenvían a deploy/scripts/deploy.sh en el VPS
for arg in "$@"; do
  case "$arg" in
    --web-only)    DO_BACK=0 ;;
    --back-only)   DO_WEB=0 ;;
    --no-migrate)  SERVER_ARGS+=" --no-migrate" ;;
    --no-build)    SERVER_ARGS+=" --no-build" ;;
    --no-push)     DO_PUSH=0 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -y|--yes)      ASSUME_YES=1 ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             fail "Opción desconocida: $arg (usa --help)" ;;
  esac
done
[ "$DO_BACK" = 0 ] && [ "$DO_WEB" = 0 ] && fail "--web-only y --back-only son mutuamente excluyentes"

cd "$REPO_DIR"

# ── 0. Preflight local ───────────────────────────────────────────────────────
step "Preflight"
for bin in git ssh tar; do command -v "$bin" >/dev/null || fail "falta '$bin' en tu máquina"; done
[ "$DO_WEB" = 1 ] && { command -v node >/dev/null || fail "falta 'node' (necesario para el export web de Expo)"; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "esto no es un repo git; corre upgrade.sh desde la raíz del proyecto"
[ -x "$REPO_DIR/deploy/scripts/deploy.sh" ]      || fail "no encuentro deploy/scripts/deploy.sh ejecutable"
[ -x "$REPO_DIR/deploy/scripts/publish-web.sh" ] || fail "no encuentro deploy/scripts/publish-web.sh ejecutable"
ok "herramientas y scripts presentes"

info "Comprobando acceso SSH a $DEPLOY_HOST …"
ssh -o ConnectTimeout=10 "$DEPLOY_HOST" 'echo ok' >/dev/null 2>&1 \
  || fail "no hay acceso SSH a $DEPLOY_HOST (revisa tu llave / VPN / que el host esté arriba)"
ok "SSH operativo contra $DEPLOY_HOST"

# ── 1. Sincronización de código (git push) ───────────────────────────────────
# El servidor hace `git pull --ff-only`: solo despliega lo que esté en
# origin/$DEPLOY_BRANCH. Aquí garantizamos que origin está al día.
if [ "$DO_BACK" = 1 ]; then
  step "Código → origin/$DEPLOY_BRANCH"
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [ "$CURRENT_BRANCH" = "$DEPLOY_BRANCH" ] \
    || fail "estás en '$CURRENT_BRANCH' pero producción despliega '$DEPLOY_BRANCH'. Haz checkout de '$DEPLOY_BRANCH' (o exporta DEPLOY_BRANCH=$CURRENT_BRANCH si es intencional)."

  if [ -n "$(git status --porcelain)" ]; then
    git status --short
    if [ "$ALLOW_DIRTY" = 1 ]; then
      warn "árbol sucio: lo NO commiteado de arriba NO se desplegará (solo lo que esté en origin)."
    else
      fail "hay cambios sin commitear. Commitéalos y reintenta, o usa --allow-dirty para desplegar solo lo que ya está en origin."
    fi
  fi

  info "git fetch origin $DEPLOY_BRANCH …"
  git fetch --quiet origin "$DEPLOY_BRANCH"
  # left = commits en origin que no tengo (detrás); right = míos que origin no tiene (adelante).
  read -r BEHIND AHEAD < <(git rev-list --left-right --count "origin/$DEPLOY_BRANCH...HEAD")
  [ "$BEHIND" -gt 0 ] && fail "estás $BEHIND commit(s) DETRÁS de origin/$DEPLOY_BRANCH; haz 'git pull --rebase' y resuelve antes de desplegar."

  if [ "$AHEAD" -gt 0 ]; then
    if [ "$DO_PUSH" = 1 ]; then
      info "empujando $AHEAD commit(s) a origin/$DEPLOY_BRANCH …"
      git push origin "$DEPLOY_BRANCH"
      ok "push completado"
    else
      warn "$AHEAD commit(s) locales sin empujar y --no-push: el servidor NO los verá."
    fi
  else
    ok "origin/$DEPLOY_BRANCH ya está al día ($(git rev-parse --short HEAD))"
  fi
fi

# ── 2. Confirmación (una sola, antes de tocar producción) ────────────────────
step "Plan de despliegue"
printf '  Servidor : %s\n' "$DEPLOY_HOST"
printf '  Dominio  : %s  (app.%s · api.%s)\n' "$DOMAIN" "$DOMAIN" "$DOMAIN"
printf '  Backend  : %s%s\n' "$([ "$DO_BACK" = 1 ] && echo 'sí' || echo 'NO (--web-only)')" "$([ -n "$SERVER_ARGS" ] && echo " ·$SERVER_ARGS" || echo '')"
printf '  App web  : %s  (API horneada: %s)\n' "$([ "$DO_WEB" = 1 ] && echo 'sí' || echo 'NO (--back-only)')" "$API_URL"
printf '  Commit   : %s — %s\n' "$(git rev-parse --short HEAD)" "$(git log -1 --pretty=%s)"
if [ "$ASSUME_YES" = 0 ]; then
  printf '\n\033[1m¿Desplegar a PRODUCCIÓN? [y/N] \033[0m'
  read -r reply
  case "$reply" in [yY]|[yY][eE][sS]) ;; *) fail "cancelado por el usuario" ;; esac
fi

# ── 3. Backend en el VPS ─────────────────────────────────────────────────────
if [ "$DO_BACK" = 1 ]; then
  step "Backend en $DEPLOY_HOST"
  # deploy.sh (en el servidor): pull → build → migraciones → up -d → verificación.
  # Reenviamos --no-build/--no-migrate si se pidieron. Sale != 0 si algo falla → aquí
  # abortamos (set -e) y NO se publica la web.
  ssh -o ConnectTimeout=15 "$DEPLOY_HOST" "cd $REMOTE_REPO && ./deploy/scripts/deploy.sh$SERVER_ARGS" \
    || fail "el despliegue del backend falló en el VPS (revisa arriba, o ssh $DEPLOY_HOST '~/preztia/deploy/scripts/logs.sh --errors')"
  ok "backend actualizado"
fi

# ── 4. Frontend (app web) desde local ────────────────────────────────────────
if [ "$DO_WEB" = 1 ]; then
  step "App web (Expo → Caddy)"
  # publish-web.sh corre EN LOCAL: export de Expo con EXPO_PUBLIC_API_URL=$API_URL y
  # subida por tar-sobre-ssh (conserva el inodo del bind-mount de Caddy → sin 404).
  API_URL="$API_URL" DEPLOY_HOST="$DEPLOY_HOST" "$REPO_DIR/deploy/scripts/publish-web.sh" \
    || fail "la publicación de la app web falló (el backend YA quedó actualizado; reintenta con --web-only)"
  ok "app web publicada"
fi

# ── 5. Verificación externa (HTTPS de punta a punta) ─────────────────────────
step "Verificación externa (HTTPS)"
verify() { # <etiqueta> <url>
  local label="$1" url="$2" code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo 000)"
  case "$code" in
    200|301|302|308) ok  "$label → HTTP $code  ($url)" ;;
    000)             warn "$label → SIN RESPUESTA  ($url) — ¿DNS/TLS aún propagando?" ;;
    *)               warn "$label → HTTP $code  ($url) — revísalo" ;;
  esac
}
[ "$DO_BACK" = 1 ] && verify "API     " "https://api.$DOMAIN/"
verify "Landing " "https://$DOMAIN/"
[ "$DO_WEB" = 1 ]  && verify "App web " "https://app.$DOMAIN/"

step "Listo"
ok "Despliegue terminado ($(git rev-parse --short HEAD))."
printf '\033[2mDiagnóstico:  ssh %s '"'"'~/preztia/deploy/scripts/logs.sh'"'"'\033[0m\n' "$DEPLOY_HOST"
