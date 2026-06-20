#!/usr/bin/env bash
#
# reset-demo.sh — Reinicia los DATOS de la base para pruebas aisladas end-to-end.
#
# Qué hace (idempotente, repetible):
#   1. Levanta Postgres (docker compose) si no está arriba y espera a que esté listo.
#   2. Aplica migraciones pendientes (por si la BD es nueva).
#   3. Construye el paquete @preztiaos/db (el seed importa su dist/).
#   4. BORRA toda la información y siembra los datos base de demo (seed-demo.ts):
#      tenant + config (fija el Phone Number ID real de WhatsApp, ver abajo),
#      usuarios de todos los roles, zonas, catálogo de documentos,
#      una cuenta bancaria Inter (BR) y una caja de cada tipo (CASH/BANK/TRANSIT).
#
# No pre-carga deudor/crédito: el flujo de WhatsApp arranca desde cero.
#
# Uso:   ./reset-demo.sh
# Env opcionales:
#   SEED_WHATSAPP_PHONE_NUMBER_ID=...  fuerza un número de WhatsApp distinto
#   SEED_CURRENCY=COP                  cambia la moneda del tenant (default BRL)

set -euo pipefail
cd "$(dirname "$0")"

PG_CONTAINER="preztiaos-pg"
PG_USER="preztia"
PG_DB="preztiaos"

# Phone Number ID real del número de WhatsApp en Meta (NO el número telefónico).
# El seed lo usa con máxima precedencia (env ?? valor previo ?? default), así el
# reset siempre deja el mapeo correcto número→tenant. Override puntual:
#   SEED_WHATSAPP_PHONE_NUMBER_ID=otro ./reset-demo.sh
export SEED_WHATSAPP_PHONE_NUMBER_ID="${SEED_WHATSAPP_PHONE_NUMBER_ID:-1108588789011965}"

echo "▶ 1/4 Levantando Postgres…"
docker compose up -d postgres >/dev/null

echo "▶ Esperando a que Postgres esté listo…"
for i in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ Postgres no respondió a tiempo." >&2
    exit 1
  fi
  sleep 1
done

echo "▶ 2/4 Aplicando migraciones…"
pnpm db:migrate

echo "▶ 3/4 Construyendo @preztiaos/db…"
pnpm --filter @preztiaos/db build >/dev/null

echo "▶ 4/4 Limpiando y sembrando datos de demo…"
pnpm --filter api run seed:demo

echo ""
echo "✔ Listo. Reinicia la API si está corriendo (para refrescar cachés como la moneda por tenant):"
echo "    pnpm dev"
