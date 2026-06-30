# Mercado Pago como banco + validador antifraude de recibos PIX

Guía operativa del proveedor **Mercado Pago** y del validador antifraude de comprobantes PIX.
Diseño y plan: [PLAN_MERCADOPAGO_ANTIFRAUDE_PIX.md](PLAN_MERCADOPAGO_ANTIFRAUDE_PIX.md). Validación
documental contra docs oficiales: [VALIDATION_MERCADOPAGO_PIX.md](VALIDATION_MERCADOPAGO_PIX.md).

## Idea en una frase

> Un comprobante **no** es prueba de pago. Solo el **crédito real** del `settlement_report`
> libera dinero. La IA y las reglas síncronas son un **filtro temprano** (alertas/rechazos
> baratos); la **confirmación** la da el match contra el reporte.

## Cómo configurar un banco Mercado Pago (Ajustes → Cuentas bancarias, solo ADMIN)

1. Crear una cuenta con **Proveedor = Mercado Pago**.
2. Cargar las credenciales del panel de MP (se guardan **cifradas**, nunca se devuelven):
   - **Public Key** (frontend) y **Access Token** (backend, privado).
   - **Secreto del webhook** (panel → Webhooks) para validar la firma de "reporte listo".
3. **Identidad del recebedor**: llave PIX recaudadora + CPF/CNPJ + titular. Es lo que el
   validador exige que coincida con el comprobante (si no coincide → rechazo).
4. **Config del reporte** (no secreta): idioma (se fija `en`), zona horaria y ventana en días.
5. Botón **"Probar credenciales"** → llama `GET /users/me` de MP con el access token (sin
   exponerlo) y responde si MP las acepta.

Equivalente por API (ADMIN, JWT): `POST/PATCH /bank-accounts` (`providerType: "MERCADOPAGO"`,
`publicKey`, `accessToken`, `webhookSecret`, `pixKey`, `receiverTaxId`, `receiverName`,
`reportConfig`) y `POST /bank-accounts/:id/verify-credentials`.

## Cómo funciona el validador (dos fases)

- **Fase 1 — pre-screen síncrono (barato, determinista).** Rechaza fraude evidente sin esperar
  el reporte: E2E bien formado (estructura Bacen + ISPB de institución real), E2E no reusado,
  imagen no reusada (sha256), **recebedor coincide** con la cuenta, sanidad temporal, y un score
  blando de IA (alerta, **no** decide). Reglas en `payment-antifraud.service.ts`.
- **Fase 2 — confirmación contra ground truth (decide).** Trae los créditos del
  `settlement_report`, filtra PIX recibidos (`bank_transfer`, neto > 0, sin REFUND/CHARGEBACK) y
  empareja por **monto único + consumo idempotente por SOURCE_ID**. Con match → **CONFIRMED**
  (recién aquí se abona); sin match tras la ventana → **UNCONFIRMED** (no se libera).

## Cómo correr el ciclo de conciliación

- **Webhook (push):** MP llama `POST /webhooks/mercadopago/:tenantId` cuando hay reporte listo;
  se valida la firma HMAC-SHA256 y se ingieren los créditos (idempotente por SOURCE_ID).
- **On-demand / cron (pull):** `POST /payments/reconcile-settlement` (header `x-tenant-id`):
  trae el reporte de la ventana, ingiere, empareja y confirma.

## Cómo se prueba SIN sandbox

El sandbox de MP devuelve **reportes vacíos**, así que las pruebas **no** dependen de la red:

- **Fixtures** (`apps/api/src/payments/banking/mercadopago/__fixtures__/`):
  `settlement-report.sample.csv` + `receipts.fixture.ts` (casos: válido, E2E malformado, E2E
  reusado, recebedor erróneo, monto que matchea, monto sin match). El spec
  `mercadopago-fixtures.spec.ts` demuestra los veredictos esperados.
- **Tests:** `pnpm --filter api test` (unit) y `pnpm --filter api test:integration` (Postgres
  real + RLS: cifrado de credenciales, ingestión idempotente, consumo atómico y el **ciclo
  completo**, incluido el caso "comprobante falso perfecto" → UNCONFIRMED).
- **Seed de demo:** `pnpm --filter api seed:demo` y luego `pnpm --filter api seed:mercadopago`
  → crea un banco MP (credenciales de **ejemplo**), comprobantes pendientes y créditos
  sintéticos ya ingeridos. Después, `POST /payments/reconcile-settlement` confirma "valido" y
  "monto_matchea" y deja "monto_sin_match" sin confirmar.

## Supuestos pendientes de confirmar contra un reporte PRODUCTIVO real

(Detalle en [VALIDATION_MERCADOPAGO_PIX.md](VALIDATION_MERCADOPAGO_PIX.md).)

1. **Firma de la notificación "reporte listo"**: implementada **HMAC-SHA256** (estándar MP); si
   esa notificación específica usara el esquema legado **BCrypt**, hay estrategia configurable
   (`MP_WEBHOOK_SIGNATURE_STRATEGY`) — habilitarla requeriría una librería bcrypt (con autorización).
2. **Forma exacta de la fila de un PIX recibido** en el CSV: valores reales de
   `PAYMENT_METHOD_TYPE` (`bank_transfer`?), `TRANSACTION_TYPE`, signo de `SETTLEMENT_NET_AMOUNT`.
3. **Respuestas de `list`/`download`** del reporte (nombres de campos: `status: "processed"`,
   `file_name`) y el body exacto de `config` (columnas/idioma).
4. Que una **transferencia PIX libre** efectivamente no genere `payment` ni webhook `payment`
   (solo aparezca en el settlement).

## Variables de entorno relevantes

- `SECRETS_ENCRYPTION_KEY` (o `KYC_ENCRYPTION_KEY`): clave AES-256 (base64, 32 bytes) para cifrar credenciales.
- `MP_API_BASE_URL` (default `https://api.mercadopago.com`), `MP_API_TIMEOUT_MS`.
- `MP_REPORT_POLL_ATTEMPTS`, `MP_REPORT_POLL_DELAY_MS`: espera del reporte asíncrono.
- `MP_WEBHOOK_SIGNATURE_STRATEGY`: `hmac-sha256` (default) | `legacy-bcrypt`.
