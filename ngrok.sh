#!/usr/bin/env bash
set -euo pipefail

# Expone el API local (NestJS) a internet vía ngrok.
# Útil para recibir webhooks de WhatsApp en desarrollo.
# El puerto coincide con apps/api (process.env.PORT ?? 3000).

PORT="${PORT:-3000}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok no está instalado o no está en el PATH." >&2
  echo "Instálalo desde https://ngrok.com/download" >&2
  exit 1
fi

echo "Iniciando ngrok hacia http://localhost:${PORT} ..."
exec ngrok http "${PORT}"
