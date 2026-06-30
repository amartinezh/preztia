# VALIDATION.md — Validación documental Mercado Pago (Fase 0)

> Fase 0 obligatoria del [plan](PLAN_MERCADOPAGO_ANTIFRAUDE_PIX.md). Verifica punto por punto los hechos del brief contra documentación oficial vigente. Fecha de verificación: **2026-06-29**.
> Leyenda: ✅ CONFIRMADO · ⚠️ CAMBIÓ (ajuste requerido) · ❔ NO VERIFICABLE (diseño defensivo).

## Resumen de impacto

- **2 cambios con impacto en el diseño:**
  1. **Webhook = HMAC-SHA256, no BCrypt** (punto 7). → Resuelve una decisión abierta: **no se necesita dependencia BCrypt**; se usa `node:crypto` (built-in) reusando el patrón de [whatsapp-signature.ts](../apps/api/src/conversations/whatsapp-signature.ts).
  2. **Ciclo del reporte: 202 Accepted** (no "203"), y existen endpoints extra `GET /config` y `POST/DELETE /schedule` (punto 6).
- **Confirmado el supuesto que define la arquitectura:** MP **no** ofrece saldo autoritativo en tiempo real (endpoint 403 + en deprecación; SDK sin cliente de balance) → ground truth = `settlement_report` async. La estructura del E2E PIX quedó **confirmada al detalle** (sirve para la regla Fase 1).
- **2 puntos NO verificables por doc oficial** (comportamiento conocido/comunidad): sandbox con reportes vacíos y la distinción exacta "transferencia PIX libre no es payment". Se mantienen por **diseño defensivo** (ya asumido en el plan).

---

## 1. Credenciales: `public_key` (frontend) + `access_token` (backend), test/prod — ✅ CONFIRMADO

Cita oficial: *"The application's public key is generally used in the frontend… The Access Token is the application's private key that should always be used in the backend… keep this information safe on your servers."* Existen credenciales de **Testing** y **Production**; ambas exponen Public Key + Access Token (y además Client ID/Client Secret para OAuth/Client Credentials).

**Ajuste:** ninguno. Además del par PK/AT, MP ofrece `client_id`/`client_secret` (OAuth) — el modelo `bank_credential` admite N secretos, así que cabe sin cambios.

Fuentes:
- https://www.mercadopago.com.ar/developers/en/docs/your-integrations/credentials
- https://www.mercadopago.com.co/developers/en/docs/credentials

## 2. PIX con cobro generado por ti → objeto `payment` (pending→approved), en `/v1/payments/search` + webhook — ✅ CONFIRMADO (comportamiento estándar)

El flujo Checkout API/Orders PIX crea un `payment` con `status` `pending` → `approved`/`accredited`, consultable por `GET /v1/payments/search` y notificado por webhook `payment`. Es el modelo documentado de la API de pagos.

**Ajuste:** ninguno. Nota: este **no** es nuestro caso principal (gota a gota recibe transferencias PIX libres, no cobros generados). Lo soportamos como vía secundaria si en el futuro se generan cobros/QR.

Fuente:
- https://www.mercadopago.com.ar/developers/en/reference (Payments → Search) · https://www.mercadopago.com.ar/developers/en/reference/payments/_payments/post

## 3. Transferencia PIX directa a tu llave (sin cobro) → ingreso de dinero, NO `payment` — ❔ NO VERIFICABLE por doc oficial (comportamiento conocido)

No hay un enunciado oficial único que diga "una transferencia PIX libre no genera objeto `payment` ni webhook `payment`"; lo respaldan reportes de la comunidad y se deduce de que esos ingresos solo figuran en el **reporte de Dinero en cuenta** (settlement). La doc oficial de movimiento de dinero recibido apunta a Actividad/reportes, no a `/v1/payments/search`.

**Ajuste (diseño defensivo):** no depender de `/v1/payments/search` para detectar PIX recibidos del gota a gota; usar `settlement_report` como fuente de verdad (ya es la decisión del plan). Documentar como **supuesto a confirmar contra una cuenta productiva real**.

Fuentes (comunidad/ayuda):
- https://www.mercadopago.com.br/ajuda/deposito-com-pix_26771
- https://groups.google.com/g/mercadopago-developers/c/iWV1ttfrCRU

## 4. No hay saldo autoritativo en tiempo real por API pública — ✅ CONFIRMADO

`GET /users/{id}/mercadopago_account/balance` devuelve **403 ForbiddenApiError "Public access not allowed"**; el endpoint **está en deprecación** y no todos los merchants tienen acceso. El **SDK Node oficial no incluye cliente de balance/account** (clientes disponibles: Payment, Order, Preferences, PreApproval, Customers & Cards, Merchant Orders, Money Requests, AdvancedPayment, DisbursementRefund, Chargeback, Connect — **ninguno de balance**).

**Ajuste:** ninguno; confirma la arquitectura. El adaptador de saldo de MP devuelve `unavailable` (degradación elegante, igual que un banco no soportado). La verdad de ingresos = `settlement_report`. **Impacta la matriz:** MP = saldo en tiempo real ❌ (Inter sí lo tiene).

Fuentes:
- 403: https://api.mercadopago.com/users/USER_ID/mercadopago_account/balance · https://groups.google.com/g/mercadopago-developers/c/iWV1ttfrCRU
- SDK clients: https://github.com/mercadopago/sdk-nodejs (+ Wiki)

## 5. `settlement_report` incluye PIX recibidos; columnas SOURCE_ID, PAYMENT_METHOD_TYPE=bank_transfer, etc. — ✅ CONFIRMADO (con precisión de columnas)

Columnas confirmadas en el CSV de "Account money / Dinero en cuenta": `EXTERNAL_REFERENCE`, `SOURCE_ID`, `TRANSACTION_TYPE`, `PAYMENT_METHOD_TYPE`, `PAYMENT_METHOD`, `TRANSACTION_AMOUNT`, `SETTLEMENT_NET_AMOUNT`, `SETTLEMENT_DATE`, `TRANSACTION_DATE`. Las columnas son **personalizables** vía un array `columns` con `key` por columna.

**Ajuste:** fijar explícitamente el set de columnas que necesitamos vía `columns` al crear/actualizar la config (no asumir el default). Confirmar el **valor exacto** de `PAYMENT_METHOD_TYPE` para PIX (`bank_transfer`) y de `PAYMENT_METHOD`/`TRANSACTION_TYPE` contra un reporte productivo real (en sandbox saldrá vacío).

Fuentes:
- https://www.mercadopago.com.co/developers/en/docs/subscriptions/additional-content/reports/account-money/api
- https://omega.mercadopago.com.br/developers/en/reference/settlements-report/create-report/post

## 6. Ciclo de vida del reporte — ⚠️ CAMBIÓ (ajuste de detalles)

Endpoints/métodos confirmados (base `https://api.mercadopago.com`):

| Operación | Método + path | Código |
|---|---|---|
| Crear config | `POST /v1/account/settlement_report/config` | 201 |
| Leer config | `GET /v1/account/settlement_report/config` | 200 |
| Actualizar config | `PUT /v1/account/settlement_report/config` | 200 |
| Crear reporte | `POST /v1/account/settlement_report` `{begin_date,end_date}` (ISO) | **202 Accepted** (async) |
| Listar reportes | `GET /v1/account/settlement_report/list` | 200 |
| Descargar | `GET /v1/account/settlement_report/:file_name` | 200 |
| Programar automático | `POST /v1/account/settlement_report/schedule` | — |
| Desprogramar | `DELETE /v1/account/settlement_report/schedule` | — |

**Cambios vs. brief:**
- El brief decía "202 async; **203** = no se pudo crear, reintentar". La doc oficial documenta **202 Accepted** para creación async; el "203" **no se confirma**. → Tratar el éxito como 202; cualquier código ≠ 2xx ⇒ reintentar con backoff (defensivo).
- Aparecen endpoints **`GET /config`** y **`POST/DELETE /schedule`** no mencionados en el brief → aprovechables (config idempotente: `GET` antes de `POST/PUT`; `schedule` para automatizar la generación diaria).
- `begin_date`/`end_date` en **ISO/UTC**.

Fuentes:
- https://www.mercadopago.com.co/developers/en/docs/subscriptions/additional-content/reports/account-money/api
- https://www.mercadopago.com.br/developers/en/reference/releases-report/update-configurations/put
- https://www.mercadopago.com.co/developers/en/reference/settlements-report/download-report/get

## 7. Firma del webhook de reporte = BCrypt(...) — ⚠️ CAMBIÓ → es **HMAC-SHA256** (`x-signature`)

El esquema oficial vigente de firma de webhooks de MP es **HMAC-SHA256** con la cabecera `x-signature` (formato `ts=<timestamp_ms>,v1=<hmac_hex>`) y `x-request-id`. El **manifest** firmado es la plantilla `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y la clave es el **secret** definido en el panel (Webhooks). La fórmula **BCrypt(transaction_id + '-' + password + '-' + generation_date)** del brief **no se confirma** en la doc oficial actual (parece esquema legado de "Notificación por Webhook" de reportes).

**Ajuste (importante):**
- Diseñar el verificador con **HMAC-SHA256 por defecto** usando `node:crypto` (timing-safe compare), **sin nueva dependencia** (resuelve la decisión abierta del plan). Reusar el patrón de [whatsapp-signature.ts](../apps/api/src/conversations/whatsapp-signature.ts).
- Hacer el **algoritmo y el manifest configurables** por proveedor (estrategia `hmac-sha256` | `legacy-bcrypt`) para tolerar que la notificación específica de "reporte listo" use el esquema legado. Si y solo si se confirma BCrypt contra una notificación real, se habilita esa estrategia (y ahí sí se evaluaría una lib, **con autorización**).
- **Confirmar contra una notificación de reporte real** cuál esquema llega (es el supuesto pendiente #1 del README).

Fuentes:
- https://www.mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks
- https://www.mercadopago.com.pe/developers/en/news/2024/01/11/Webhooks-Notifications-Simulator-and-Secret-Signature

## 8. `report_translation` (en/es/pt) cambia encabezados → fijarla — ✅ CONFIRMADO (parcial)

La config del reporte permite personalizar columnas (array `columns` con `key`) y el idioma/locale de salida. Los encabezados del CSV dependen de la traducción.

**Ajuste:** fijar `report_translation` y el set `columns` explícitamente en la config (almacenado en `tenant_bank_account.report_config`); el parser CSV se ata a ese set fijado (no autodetecta encabezados). Confirmar nombre exacto del parámetro (`report_translation`) contra la doc de config al implementar.

Fuente:
- https://www.mercadopago.com.co/developers/en/docs/subscriptions/additional-content/reports/account-money/api

## 9. En sandbox los reportes salen VACÍOS — ❔ NO VERIFICABLE por doc oficial (caveat conocido)

No hay enunciado oficial; es limitación conocida del ambiente de prueba (los flujos config/generate/list/download funcionan, sin datos).

**Ajuste (diseño defensivo):** los tests de conciliación **no** dependen del sandbox: usar **fixtures CSV sintéticos**. Ya es la decisión del plan (§7–§8).

## 10. `EXTERNAL_REFERENCE` vacío en transferencias libres; el reporte NO trae E2E → match por monto único + SOURCE_ID — ✅ CONFIRMADO (consistente)

`EXTERNAL_REFERENCE` solo se llena cuando tú lo seteas al crear un cobro; en transferencias PIX libres no hay cobro → viene **vacío**. El `settlement_report` **no tiene columna de E2E** (no figura en el set de columnas) → **no hay match E2E↔reporte**.

**Ajuste:** match determinista por **monto único (centavos únicos por pedido) + consumo idempotente por `SOURCE_ID`** (índice único `(tenant_id, source_id)` en `incoming_credit`). No usar `EXTERNAL_REFERENCE` como llave.

Fuente:
- https://www.mercadopago.com.co/developers/en/docs/subscriptions/additional-content/reports/account-money/api

## 11. Estructura del E2E ID PIX — ✅ CONFIRMADO (al detalle, fuente Bacen)

Formato oficial Bacen: **`ExxxxxxxxyyyyMMddHHmmkkkkkkkkkkk`**, **32 caracteres, case-sensitive**:
- `E` — fijo (1).
- `xxxxxxxx` — **ISPB** del participante (o primeros 8 dígitos del CNPJ del PSP), **8 dígitos numéricos** `[0-9]`.
- `yyyyMMddHHmm` — fecha/hora UTC (12).
- `kkkkkkkkkkk` — secuencial/identificador (11, alfanumérico).

**Ajuste:** la regla `E2EWellFormedRule` valida: longitud == 32, prefijo `E`, ISPB = 8 dígitos numéricos que **mapean a institución real** (cargar tabla ISPB del Bacen/STR), `yyyyMMddHHmm` parseable y coherente (no futura / no demasiado vieja). Malformado o ISPB inexistente ⇒ REJECT.

Fuentes:
- Bacen — Manual de Padrões para Iniciação do Pix: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
- Tabla ISPB (referencia): https://www.bcb.gov.br + https://dev.paybrokers.com/docs/ispb

---

## Supuestos pendientes de confirmar contra una cuenta PRODUCTIVA real (van al README)

1. **Esquema de firma de la notificación "reporte listo"** (HMAC-SHA256 vs legado BCrypt) — diseño tolera ambos vía estrategia configurable.
2. **Forma exacta de la fila de un PIX recibido** en el CSV: valores reales de `PAYMENT_METHOD_TYPE` (`bank_transfer`?), `TRANSACTION_TYPE`, `PAYMENT_METHOD`, signo de `SETTLEMENT_NET_AMOUNT`, y exclusión de REFUND/CHARGEBACK.
3. **Nombre/valores exactos** del parámetro de idioma (`report_translation`) y del set `columns` por defecto.
4. **Confirmar** que una transferencia PIX libre efectivamente no genera `payment` ni webhook `payment` (solo aparece en settlement).
