# PicPay — validación antifraude de pagos PIX

> Tercera entidad de validación, junto a **Banco Inter** (per-PIX + saldo) y **Mercado Pago**
> (settlement_report). Fuente arquitectónica: [ARCHITECTURE.md](ARCHITECTURE.md) (ADR #32).
> Fecha: 2026-07-05. Documentación oficial: <https://developers-business.picpay.com/pix/docs/introduction>.

---

## 1. Cómo funciona PicPay (investigación, validada contra la doc oficial)

| Aspecto | Detalle |
|---|---|
| Producto | **API Pix PicPay** (developers-business.picpay.com/pix) |
| Autenticación | OAuth2 `client_credentials`: `POST https://checkout-api.picpay.com/oauth2/token` con `client_id` + `client_secret` (del Painel Lojista → Integrações → "Gerar Token"). Token Bearer con vida de **5 minutos**. Sin mTLS ni certificados. |
| Cobro | `POST /charge/pix` → devuelve `qrCode`, `qrCodeBase64` y **`endToEndId`**; `merchantChargeId` identifica el cobro. Consulta: `GET /charge/{merchantChargeId}`. |
| Webhook | Se configura la **URL de notificación** en el Painel Lojista (Ajustes → *Meu checkout*). PicPay genera un **token estático** (se muestra UNA sola vez) que viaja en el header `Authorization` de cada notificación. Header `event-type: TransactionUpdateMessage`. Notifica pagos, cancelaciones y expiraciones. |
| Payload | `{ type, eventDate, merchantDocument, id, data: { status: "PAID"|…, amount (centavos), merchantChargeId, customer, transactions: [{ paymentType: "PIX", amount, pix: { endToEndId } }] } }` |
| Saldo | **No hay API pública de saldo en tiempo real** → el registro `BankBalanceProviderRegistry` degrada a `unavailable`. |

**Limitación clave (igual que Mercado Pago):** una transferencia PIX "libre" directa a la llave de
la cuenta PicPay **no** pasa por la API de cobranças ni dispara el webhook. El **procedimiento
correcto para registrar los pagos** es que el cobro se genere como *cobrança* PicPay (QR /
copia-e-cola) — así **todo pago queda registrado dos veces**: el webhook (ground truth con E2E)
y el comprobante que el cliente manda por WhatsApp (claim).

## 2. Flujo end-to-end

```
Cliente paga la cobrança PIX (QR PicPay)
        │
        ├──► PicPay → POST /webhooks/picpay/:tenantId  (Authorization: token)
        │      1. verifyPicPayWebhook  (timing-safe contra el token cifrado del tenant)
        │      2. provider_webhook_event  ← SE REGISTRA TODA NOTIFICACIÓN (idempotente)
        │      3. status PAID → incoming_credit (con end_to_end_id; idempotente por sourceId)
        │      4. RunSettlementReconciliation({refresh:false}) → confirma claims pendientes
        │
        └──► Cliente manda la captura por WhatsApp
               1. Gemini extrae el PIX (monto, E2E, recebedor…)
               2. Fase 1 antifraude (dedup sha256/E2E, E2E bien formado/ISPB, recebedor, antigüedad)
               3. Verificación bancaria contra las cuentas con "Validación de pagos" ON
                  (orden: PICPAY → INTER → MERCADOPAGO)
               4. Queda UNVERIFIED (HOLD) → el decorador SubmitReceiptThenSettle concilia
                  al instante con lo ya ingerido: si el webhook ya llegó, el pago se
                  CONFIRMA (match por E2E, o por monto único) y se abona la cartera.
```

- **Toda confirmación pasa por `confirmWithCredit`** (consume el crédito y verifica el pago en
  UNA transacción, FOR UPDATE): un crédito real valida **a lo sumo un** pago (I1). La imagen
  nunca libera dinero (I6).
- El match del dominio (`matchCreditsToClaims`) es en **dos pasadas**: primero **E2E idéntico**
  (I7, inequívoco — el monto abonado es el del crédito real) y luego **monto único** en centavos.

## 3. Configuración (panel de Ajustes → Cuentas bancarias)

1. Crear cuenta con proveedor **PicPay** (país `BR`, código `PICPAY`).
2. Identidad del recebedor: llave PIX, CPF/CNPJ y titular (para el match antifraude del recibo).
3. Credenciales (cifradas AES-256-GCM en `bank_credential`, write-only):
   - `client_id` + `client_secret` (OAuth2) → botón **"Probar credenciales"** pide un token real.
   - **Token del webhook** (el `Authorization` que PicPay genera al configurar la URL).
4. Registrar en el Painel Lojista la URL: `https://<api>/webhooks/picpay/<tenantId>`.
5. **Toggles por cuenta** (aplican a PicPay, Mercado Pago y Banco Inter):
   - *Medio de pago activo* (`active`) — apaga la cuenta por completo.
   - *Validación de pagos* (`verify_payments_enabled`) — ¿participa al validar comprobantes y en
     la conciliación? Permite elegir con cuál(es) entidades se valida un pago.
   - *Validación de saldo* (`balance_check_enabled`) — habilita "Sincronizar saldo" contra el
     banco (aplica a Inter; PicPay/MP no tienen saldo por API).
   - **PicPay queda prendida por defecto** (defaults `true`) y es la **primera** en el orden de
     verificación (`VERIFICATION_PRIORITY` en [tenant-bank-account.repository.ts](../apps/api/src/payments/tenant-bank-account.repository.ts)).

## 4. Modelo de datos (migración 0043)

| Tabla | Cambio |
|---|---|
| `bank_provider_type` | + valor `PICPAY` |
| `tenant_bank_account` | + `verify_payments_enabled` / `balance_check_enabled` (boolean, default `true`) |
| `incoming_credit` | + `end_to_end_id` (nullable; PicPay lo trae, MP no) + índice `(tenant, end_to_end_id)` |
| `provider_webhook_event` | **NUEVA**: bitácora append-only de TODOS los webhooks (PAID/CANCELED/EXPIRED…), única por `(tenant, provider, event_id)`, RLS FORCE, `GRANT SELECT, INSERT` (sin UPDATE/DELETE) |

Aplicar con `pnpm db:migrate` (la BD local `preztiaos-pg` debe estar arriba; ojo si otro
contenedor ocupa el puerto 5432).

## 4b. Conciliación: automática vs. manual (toggle)

Ajuste **por tenant** en *Ajustes → Configuración de cobro*: **"Conciliación automática de pagos"**
(`operationalSettings.autoConfirmSettlement`), **apagado por defecto**.

| Toggle | Al encontrar un match (crédito real ↔ comprobante) | Estado del pago | Quién lo hace efectivo |
|---|---|---|---|
| **OFF** (default) | **Reserva** el crédito (lo consume para que no lo tome otro match) y marca el pago `PENDING_REVIEW` | sigue `UNVERIFIED` — **no abona** | un humano, con el botón "Validar y abonar" |
| **ON** | Confirma y abona en la misma transacción (100% seguro = crédito real) | `VERIFIED` + cartera abonada | automático |

**Conciliación manual (toggle OFF):** el pago aparece con la etiqueta **"Aprobar"** en la lista y un
banner **"Pago real conciliado — pendiente de aprobación"** en el detalle. El coordinador/admin lo
valida por sus medios y pulsa **"Validar y abonar"** (motivo obligatorio): el abono usa el **monto
del crédito real reservado** (no el extraído del OCR). Los pagos marcados como **fraude** entran a la
misma cola: el humano puede validarlos manualmente y hacerlos efectivos igual (con override de monto
si el OCR falló). Todo queda en el `audit_log` + `fraud_assessment` (`PENDING_REVIEW` → `CONFIRMED`).

> **Invariante:** con el toggle OFF, **ningún pago se hace efectivo sin una acción humana explícita**.
> Reservar consume el crédito atómicamente (una reserva por pago, no se re-reserva en ciclos siguientes);
> la aprobación es idempotente (un pago ya `VERIFIED` no se revalida).

Archivos: [settlement-review-settings.reader.ts](../apps/api/src/payments/settlement-review-settings.reader.ts) ·
[run-settlement-reconciliation.service.ts](../apps/api/src/payments/run-settlement-reconciliation.service.ts) (`reserveMatch`) ·
[payment-reconciliation.repository.ts](../apps/api/src/payments/payment-reconciliation.repository.ts) (`reserveCreditForReview`) ·
[manual-verify-payment.repository.ts](../apps/api/src/payments/manual-verify-payment.repository.ts) (usa el crédito reservado).

## 5. Vista gráfica del veredicto

- **Listado de pagos**: badge por estado (Verificado ✅ / Sin verificar ⚠ / **Fraude** ✖).
- **Detalle del pago** → tarjeta **"Validaciones del pago"** (semáforo):
  1. *Antifraude del comprobante* (Fase 1) — ✓/⚠/✗ con los motivos y **barra de riesgo 0–100**.
  2. *Verificación bancaria en línea* — Confirmado / No encontrado / No disponible.
  3. *Crédito real conciliado* (webhook PicPay / reporte MP) — Confirmado / **Pendiente de aprobación** / Pendiente.
  4. *Validación manual* — solo si un revisor intervino.
  Los datos salen de la bitácora `fraud_assessment` (expuesta en `paymentDetail.assessments`).
- **Cola de conciliación manual**: los pagos con crédito real reservado muestran la etiqueta
  **"Aprobar"** en la lista (`paymentSummary.awaitingManualReview`); su detalle abre con el banner
  de aprobación y el botón "Validar y abonar".

## 5b. Cobro conversacional (cobrança PIX con monto libre)

Cierra la **mitad delantera** del ciclo: el cliente elige cuánto pagar y el sistema genera la
cobrança PicPay al vuelo (`POST /charge/pix`) devolviendo el *PIX copia e cola* por WhatsApp.

**Disparadores (en cualquier momento del chat):**
1. El cliente **escribe que quiere pagar** — `detectPaymentIntent` (dominio puro, ES+PT: "quiero
   pagar", "quero pagar", "voy a pagar", "abonar", "quitar mi deuda", "pagar por pix"…). No depende
   de la IA (corre antes del asistente), así que funciona aunque el tenant no tenga IA configurada.
2. El cliente **responde el menú** de una sesión de cobro abierta.

**Flujo:**
```
Cliente: "quiero pagar"
  → OfferOrCreateChargeHandler (interceptor de texto, antes del asistente)
  → ChargeableCreditReader: crédito ACTIVO del teléfono + cuota del día + todo lo vencido
  → abre sesión (payment_charge AWAITING_SELECTION) y envía el menú:
        1️⃣ Tu cuota de hoy — R$ 250,00
        2️⃣ Todo lo pendiente — R$ 750,00
        …o responde con otro monto (ej: 150)   ← se acepta CUALQUIER valor, incluso < cuota
Cliente: "2"  (o "150", "R$ 150,50", "cuota"…)
  → parsePaymentChoice → monto
  → ChargeGateway (PicPay): POST /oauth2/token + POST /charge/pix (monto en centavos)
  → payment_charge → PENDING (merchantChargeId + copia-e-cola) + crea el COMPROBANTE esperado
     (un pago UNVERIFIED por el monto, ligado al crédito)
  → envía el PIX copia-e-cola al cliente
Cliente paga el PIX
  → webhook PAID (§2) → incoming_credit → conciliación → confirma/reserva el comprobante
     esperado (respeta el toggle §4b) + marca payment_charge PAID
```

**Diseño (SRP):** el dominio (`payment-intent.ts`) solo detecta/parsea/redacta; el caso de uso
(`OfferOrCreateChargeHandler`) orquesta puertos; la infraestructura implementa el gateway PicPay,
la sesión y el read model. La cobrança crea un **comprobante esperado** para **reusar** toda la
conciliación por settlement ya existente (incluido el toggle auto/manual) — no se inventó un
segundo camino de abono. La sesión es única por teléfono (índice parcial). Idempotente por wamid.

**Requisitos:** el tenant debe tener una cuenta **PicPay** activa con `verify_payments_enabled`
y sus credenciales OAuth (`client_id`/`client_secret`); si no, el cobro conversacional no se ofrece.

**Pendiente de validar contra PicPay real:** la forma EXACTA del request/response de `/charge/pix`
(campos de `customer`, ubicación del `qrCode`) — el cliente es defensivo y degrada con elegancia
(avisa al cliente y cierra la sesión) si el proveedor rechaza.

## 6. Archivos principales

- API: [picpay-webhook.controller.ts](../apps/api/src/payments/picpay-webhook.controller.ts) · [ingest-picpay-webhook.service.ts](../apps/api/src/payments/ingest-picpay-webhook.service.ts) · [banking/picpay/](../apps/api/src/payments/banking/picpay/) (verifier + parser + context reader + **charge client**) · [provider-webhook-event.repository.ts](../apps/api/src/payments/provider-webhook-event.repository.ts) · [run-settlement-reconciliation.service.ts](../apps/api/src/payments/run-settlement-reconciliation.service.ts) (multi-cuenta, `refresh`) · [submit-receipt-then-settle.ts](../apps/api/src/payments/adapters/submit-receipt-then-settle.ts) · [cash/banking/picpay/picpay-auth.client.ts](../apps/api/src/cash/banking/picpay/picpay-auth.client.ts)
- Cobro conversacional (API): [payments/charge/](../apps/api/src/payments/charge/) (repo sesión/cobrança + read model del crédito cobrable) · [banking/picpay/picpay-charge.client.ts](../apps/api/src/payments/banking/picpay/picpay-charge.client.ts) · [conversations/adapters/whatsapp-text.consumer.ts](../apps/api/src/conversations/adapters/whatsapp-text.consumer.ts) (cadena de interceptores)
- Dominio: [settlement-match.ts](../packages/domain/src/credit/payment/settlement-match.ts) (match E2E + monto) · [payment-intent.ts](../packages/domain/src/credit/payment/payment-intent.ts) (intención + parser de monto + mensajes)
- Aplicación: [submit-payment-receipt.ts](../packages/application/src/credit/payment/submit-payment-receipt.ts) (verificación multi-cuenta) · [payment-charge/offer-or-create-charge.ts](../packages/application/src/credit/payment-charge/offer-or-create-charge.ts) (diálogo de cobro)
- Cliente: [cash-config-screen.tsx](../apps/mobile/src/features/cash/screens/cash-config-screen.tsx) (panel + toggles) · [payment-detail-screen.tsx](../apps/mobile/src/features/payments/screens/payment-detail-screen.tsx) (semáforo)

## 7. Pruebas

- `apps/api`: `picpay-webhook.verifier.spec` (token/timing-safe), `picpay-webhook.parser.spec`
  (PAID→crédito, no-PAID, montos inválidos, eventId idempotente), `ingest-picpay-webhook.service.spec`
  (401, bitácora, ingesta, conciliación en vivo).
- `packages/domain`: `settlement-match.test` — match por E2E (I7), prioridad E2E>monto, doble
  claim mismo E2E (I1), property test I1–I5.
- `packages/domain`: `payment-intent.test` — detección de intención (ES/PT, robusto a acentos),
  parser de monto (opción 1/2, valor libre, decimales coma/punto, abono parcial), mensajes.
- `packages/application`: `offer-or-create-charge.test` — abre menú por intención, genera cobrança
  por la selección, monto libre < cuota, re-pregunta, degradación si el proveedor falla, idempotencia.
- `apps/api` (integración, con DB): `payment-charge.repository.integration` — sesión única por
  teléfono, `attachCharge` crea el comprobante esperado + avanza a PENDING, estado por webhook.
- `packages/application`: `submit-payment-receipt.test` — multi-cuenta (prioridad, primera
  confirma corta, ranking not_found>unavailable).

## 8. Supuestos y pendientes

- La forma EXACTA del payload del webhook puede variar por versión del producto → el parser es
  **defensivo** (todo opcional, degrada a "solo bitácora" sin romper; los nombres viajan en
  `zod.passthrough`). Validar contra una notificación productiva real al activar el primer tenant.
- El webhook no trae monto **neto** → se ingiere el bruto (el fee de PicPay se concilia en caja).
- **Emparejamiento determinista por `merchantChargeId` (refinamiento futuro).** El comprobante
  esperado de una cobrança (§9) hoy se confirma por **monto** en la conciliación (con aprobación
  humana por defecto). Guardamos `merchantChargeId` en `payment.txid` y en `payment_charge`; un match
  por `merchantChargeId` (en vez de monto) eliminaría la colisión de dos cobros del mismo valor. Se
  deja como refinamiento; el toggle de conciliación manual ya cubre el riesgo de mala atribución.
