# PLAN — Mercado Pago como banco configurable + Validador antifraude de recibos PIX

> Estado: **PLAN / ANÁLISIS** (no implementado). Fuente de verdad arquitectónica: [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md).
> Fecha: 2026-06-29.

---

## 0. Resumen ejecutivo (lee esto primero)

**Hallazgo clave: esto NO es greenfield.** El "Antifraude Guardian" del brief ya existe en PreztiaOS bajo otros nombres. La arquitectura objetivo del brief (puertos + adaptadores, `ProviderRegistry`, reglas antifraude extensibles, `FraudAssessment`, cifrado de secretos, extractor IA del recibo) **ya está construida** para Banco Inter. El trabajo real es **agregar Mercado Pago como un proveedor nuevo reusando esas costuras**, no inventar arquitectura.

Mapa brief → código existente:

| Concepto del brief | Ya existe en el repo | Archivo |
|---|---|---|
| `ProviderRegistry` (resuelve `providerType → adaptador`) | **Sí**, dos registros keyed `"PAÍS:BANCO"` | [bank-balance.registry.ts](../apps/api/src/cash/banking/bank-balance.registry.ts), [bank-verifier.registry.ts](../apps/api/src/payments/banking/bank-verifier.registry.ts) |
| `SecretsPort` (cifrado en reposo) | **Sí**, AES-256-GCM con prefijo versionado | [secret-cipher.ts](../apps/api/src/shared/secret-cipher.ts) |
| `ReceiptExtractorPort` + `RiskAnalyzerPort` (IA solo extrae/score) | **Sí**, clasificador Gemini | [gemini-payment.classifier.ts](../apps/api/src/payments/ai/gemini-payment.classifier.ts) |
| Motor antifraude Fase 1 (composite de reglas) | **Sí**, `PaymentAntifraudComposite` + reglas | [payment-antifraud.service.ts](../apps/api/src/payments/payment-antifraud.service.ts) |
| Reglas: dedup imagen (sha256), dedup E2E, sanidad temporal | **Sí** | mismo archivo |
| `FraudAssessment` (status/score/reasons) | **Sí** (VO de dominio) | `@preztiaos/domain` |
| `ReceiptClaim` (comprobante reportado) | **Sí**, tabla `payment` (sha256, endToEndId único, receiverPixKey, amountMinor…) | [payment.ts](../packages/db/src/schema/payment.ts) |
| Idempotencia de dinero por E2E | **Sí**, índice único `(tenant, end_to_end_id)` | [payment.ts](../packages/db/src/schema/payment.ts) |
| CRUD de banco multi-tenant (ADMIN, JWT, idempotente) | **Sí** | [bank-account.controller.ts](../apps/api/src/cash/bank-account.controller.ts) |
| Pantalla de configuración de cuentas bancarias | **Sí**, pestaña en Ajustes | [bank-accounts-tab.tsx](../apps/mobile/src/features/settings/tabs/bank-accounts-tab.tsx) → `/cash/config` |
| `unverifiedPolicy` HOLD/ALLOCATE (no liberar contra imagen) | **Sí** | [tenant-bank-account.ts](../packages/db/src/schema/tenant-bank-account.ts) |
| Webhook con firma (referencia) | **Sí** (HMAC WhatsApp; MP usa BCrypt) | [whatsapp-signature.ts](../apps/api/src/conversations/whatsapp-signature.ts) |

**Lo que realmente falta** (el alcance de este plan):

1. **Credenciales dobles cifradas.** MP usa `public_key` **y** `access_token`; hoy `tenant_bank_account.api_key` es una sola columna **en claro** (la propia nota del schema dice *"mejora futura: cifrarla"*). Hay que (a) soportar N secretos por proveedor y (b) **cifrarlos en reposo** — requisito duro del brief.
2. **`providerType` configurable** (`mercadopago` | `inter` | …) — hoy se infiere de `country:bankCode`.
3. **Adaptador de conciliación por `settlement_report`** (`SettlementSourcePort.fetchCredits(window)`). El verificador actual (`BankPaymentVerifier.verify(pix)`) consulta **un** PIX por E2E — **MP no puede hacer eso** (el reporte no trae E2E). MP solo permite **batch** + match por **monto único + SOURCE_ID**. Es un modelo distinto.
4. **Webhook de "reporte listo" con firma BCrypt** + ingestión idempotente por SOURCE_ID.
5. **Reglas Fase 1 nuevas:** E2E bien formado + **ISPB → institución real**, y **match de recebedor** (llave PIX/CPF-CNPJ del recibo == identidad configurada).
6. **Tabla `incoming_credit`** (créditos del reporte, `source_id` único, consumo idempotente).
7. **Pantalla de configuración de bancos** ampliada para tipo Mercado Pago (public_key, access_token, config de reporte, secreto de webhook) — *requisito agregado por el usuario*.
8. **`VALIDATION.md`** — fase obligatoria de validación documental MP.
9. **Tests + seeds/fixtures** (incl. CSV sintético, property tests de idempotencia, BCrypt, ISPB).

**Decisión arquitectónica central (recomendada):** MP **no** es un `BankPaymentVerifier` por-PIX; es una **`SettlementSourcePort` de conciliación batch**. El verdadero "ground truth" es el `settlement_report`, no una consulta por E2E. El verificador per-PIX (Inter) y la fuente batch (MP) coexisten detrás del mismo registro de proveedores.

---

## 1. FASE 0 — Validación documental MP (obligatoria) — ✅ HECHA

> **Completada 2026-06-29.** Resultado punto por punto en **[VALIDATION_MERCADOPAGO_PIX.md](VALIDATION_MERCADOPAGO_PIX.md)**.
>
> **Dos cambios con impacto en el diseño (ya reflejados abajo):**
> 1. **Webhook = HMAC-SHA256 (`x-signature`), NO BCrypt.** → Se usa `node:crypto` (built-in), **sin nueva dependencia**; verificador con estrategia configurable (`hmac-sha256` default | `legacy-bcrypt`) por si la notificación de "reporte listo" usa el esquema legado.
> 2. **Ciclo del reporte: 202 Accepted** (no "203"); existen además `GET /config` y `POST/DELETE /schedule`.
>
> Confirmado lo que sostiene la arquitectura: MP **sin saldo en tiempo real** (403, en deprecación; SDK sin cliente de balance) y **estructura del E2E PIX** (`E`+ISPB[8]+`yyyyMMddHHmm`+11, 32 chars). NO verificables por doc oficial (→ diseño defensivo): sandbox con reportes vacíos y "PIX libre no es payment".

Tabla original de hipótesis (estado final tras validación — detalle en VALIDATION.md):

| # | Afirmación a verificar | Evaluación previa | Fuente a consultar |
|---|---|---|---|
| 1 | Dos llaves por entorno: `public_key` (frontend) + `access_token` (backend, privado). El token nunca al frontend ni a logs. | Probable **CONFIRMADO** | developers credentials |
| 2 | PIX **con cobro generado por ti** → objeto `payment` (pending→approved/accredited), visible en `GET /v1/payments/search` + webhook `payment`. | Probable **CONFIRMADO** | reference → Payments → Search |
| 3 | **Transferencia PIX directa a tu llave** (sin cobro) → ingreso de dinero, **NO** `payment`: no aparece en `/v1/payments/search` ni dispara webhook `payment`. | Probable **CONFIRMADO** (es el caso central del gota-a-gota) | docs checkout-api / foros MP |
| 4 | `/users/{id}/mercadopago_account/balance` restringido (Forbidden); SDK Node **sin** cliente de balance; no hay saldo autoritativo en tiempo real por API pública. | Probable **CONFIRMADO** — **impacta la matriz** (MP = saldo en tiempo real ❌) | sdk-nodejs, reference |
| 5 | Ground truth = **`settlement_report`** (`settlement_v2`, "Dinero en cuenta"): incluye PIX recibidos. Columnas: `SOURCE_ID`, `TRANSACTION_TYPE`, `PAYMENT_METHOD_TYPE=bank_transfer`, `TRANSACTION_AMOUNT`, `SETTLEMENT_NET_AMOUNT`, `SETTLEMENT_DATE`, `EXTERNAL_REFERENCE`… | **REVISAR** nombres exactos de columnas (cambian por versión/translation) | reference → Reports |
| 6 | Ciclo: `POST /config` (201, una vez) → `PUT /config` → `POST /v1/account/settlement_report` `{begin_date,end_date}` (202 async; 203 reintentar) → `GET …/list` (item `processed`) → `GET …/{file_name}` (CSV/XLSX). | **REVISAR** paths exactos | reference → Reports |
| 7 | Webhook "reporte listo": firma `signature == BCrypt(transaction_id + '-' + password + '-' + generation_date)`; `password` del panel. | **REVISAR** fórmula exacta y algoritmo (¿BCrypt vs HMAC?) — **crítico para seguridad** | docs webhooks reportes |
| 8 | `report_translation` (en/es/pt) cambia encabezados → **fijarla**. | Probable **CONFIRMADO** → fijaremos `en` o `pt` | reference |
| 9 | **Sandbox devuelve reportes VACÍOS** → tests con **fixtures CSV sintéticos**, no sandbox. | Probable **CONFIRMADO** → diseño defensivo ya asumido | reference / foros |
| 10 | `EXTERNAL_REFERENCE` vacío en transferencias libres → **no** usar como llave. El reporte **no** trae E2E → match por **monto único + SOURCE_ID**. | Probable **CONFIRMADO** → define el algoritmo de match | reference |
| 11 | E2E ID: ~32 chars alfanuméricos, `E + ISPB(8) + fecha + secuencial`; ISPB debe mapear a institución real. | **REVISAR** estructura exacta y **obtener tabla ISPB** (Bacen/STR). | Banco Central — Participantes do STR/PIX |

**Diseño defensivo (para lo NO verificable):** todo lo del reporte/webhook se aísla en el adaptador y el cliente HTTP; si una forma cambia, degrada a `unavailable` (igual que Inter hoy) — nunca rompe el caso de uso ni libera dinero. Los nombres de columnas y el algoritmo de firma quedan **configurables** (no hardcodeados).

---

## 2. Matriz de herramientas bancarias (calificación multidimensional)

> El usuario pidió calificar las herramientas, con foco en **"consultar mi saldo en tiempo real vía API"**. Antes de la matriz, una distinción que cambia toda la recomendación:

**Hay DOS preguntas distintas, no las mezcles:**

- **Pregunta A — "¿Entró el dinero a MI cuenta?"** (tesorería/conciliación propia + antifraude del recibo PIX). → Es el objeto de este plan. Se resuelve con la **API del propio banco recaudador** (MP, Inter…), es decir **Camino A**. *No* requiere Open Finance.
- **Pregunta B — "¿Cómo es la cuenta del SOLICITANTE de crédito?"** (KYB, extrato, capacidad de pago de un tercero). → Requiere **consentimiento del tercero** = **Open Finance** (Camino B directo o, realista, **Camino C agregadores**). Es un proyecto aparte; lo dejo dimensionado pero **fuera del alcance** de la integración MP.

### 2.1 Escala
Calificación 1–5 (5 = mejor para nuestro caso). Dimensiones: **Disp.** = disponibilidad/madurez API; **Uso** = facilidad de onboarding/DX; **Costo** (5 = más barato); **Saldo RT** = simplicidad para consultar saldo en tiempo real por API; **PJ** = cobertura/idoneidad persona jurídica; **Cert.** = baja fricción de certificación (5 = solo API key, sin certificados).

### 2.2 Camino A — API directa del banco (mTLS / OAuth propio) — *para conciliar TU cuenta*

| Banco | Disp. | Uso | Costo | Saldo RT | PJ | Cert. | Notas para nuestro caso |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Mercado Pago** | 4 | 4 | 5 | **1** | 4 | 5 | Sujeto de este plan. `public_key`+`access_token` (solo API key/OAuth, sin mTLS). **Saldo en tiempo real ❌** (endpoint balance restringido); verdad = `settlement_report` async. PIX recibido **no** es `payment`. |
| **Banco Inter** | 5 | 5 | 5 | **5** | 4 | 3 | **Ya integrado** (`/banking/v2/saldo`, [inter-balance.client.ts](../apps/api/src/cash/banking/inter/inter-balance.client.ts)). Self-service, producción en días. **Mejor opción para saldo en tiempo real.** Requiere `.crt+.key` (mTLS). |
| Banco do Brasil | 4 | 3 | 5 | 4 | 5 | 2 | Cert. A1 ICP-Brasil + `gw-dev-app-key`. PIX v2 sólido; burocrático. |
| BTG Empresas | 4 | 3 | 4 | 4 | 5 | 3 | OAuth2/OIDC (sin mTLS). Producción solo con Plano Avançado + app verificada. |
| Bradesco | 3 | 2 | 5 | 4 | 4 | 2 | Cert. ICP-Brasil + JWT firmado. Menos self-service. |
| Santander | 3 | 2 | 5 | 4 | 4 | 2 | mTLS + OAuth. Portal developers; onboarding lento. |
| Sicoob | 4 | 3 | 5 | 4 | 4 | 3 | `.pem/.pfx` por app; sandbox disponible. |
| Itaú | 3 | 2 | 4 | 3 | 5 | 1 | Acceso por convenio/gerente; poco self-service. |

**Lectura:** para "saldo en tiempo real por API" el ganador es **Inter** (ya lo tenemos). **MP es el peor en esa dimensión** — y es justamente por eso que el antifraude PIX de MP **no puede** depender del saldo: depende del `settlement_report` async + match determinista. Limitación arquitectónica, no de implementación.

### 2.3 Camino B — Open Finance directo (BRCAC + BRSEAL) — *para leer terceros*

| Opción | Disp. | Uso | Costo | Saldo RT | PJ | Cert. | Notas |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Open Finance (participante propio) | 5 | 1 | 3 | 4 | 5 | **1** | Modelo canónico de "llaves públicas": 2 certs tuyos (BRCAC transporte mTLS + BRSEAL firma JWS), SSA/`client_id`, FAPI+PKCE. **Bloqueante:** requiere ser **institución autorizada por Bacen** (ITP/receptora). Lento, regulatorio. **No recomendado** salvo que el volumen lo justifique. |

### 2.4 Camino C — Agregadores Open Finance (API key) — *vía realista para KYB/terceros*

| Agregador | Disp. | Uso | Costo | Saldo RT | PJ | Cert. | Notas |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Pluggy** | 4 | 5 | 4 | 4 | 4 | 5 | Trial sin tarjeta, sandbox dev-friendly. ~28,7% clientes CNPJ. **Mejor para POC inmediata.** ~R$2,5k/mes. |
| **Belvo** | 4 | 4 | 3 | 4 | 4 | 5 | `accounts/balances/incomes/recurring-expenses` (365 días). Cobertura PJ sólida. ~R$6k/mes. |
| **Celcoin** | 4 | 3 | 3 | 4 | **5** | 5 | Open Finance + BaaS + core + scoring. **La más profunda en PJ/crédito.** Para datos PJ + capa bancaria. |
| **Klavi** | 3 | 4 | 3 | 4 | 4 | 5 | Regulada Bacen; foco scoring/decisión de crédito. |
| Accesstage/Tecnospeed | 3 | 3 | **5** | 3 | 3 | 5 | EDI bancario/extrato; menor ticket de entrada (~R$1,5k + ~R$540/mes). |

> Costos 2026 aproximados que circulan; **validar con cada proveedor** (varían mucho por volumen).

### 2.5 Recomendación

- **Para este plan (Pregunta A — conciliar MP):** usar la **API directa de MP** (Camino A). Aceptar que **no hay saldo en tiempo real** → ground truth = `settlement_report` + webhook. Reusar el patrón Inter ya existente.
- **Para saldo en tiempo real real** (si el negocio lo pide para tesorería): **Inter ya está integrado** y es el más simple — modelar MP y mantener Inter para esa dimensión.
- **Para KYB/capacidad de pago de terceros (Pregunta B, futuro):** entrar por **agregador (Camino C)**, no certificarte (Camino B). **Pluggy** para POC inmediata; **Celcoin/Belvo** para producción PJ. → registrar como **ADR aparte**; no es parte de la integración MP.

---

## 3. Arquitectura objetivo (hexagonal) y dónde encaja cada pieza

```
HTTP (Controller, zod)  ──►  Caso de uso (*Handler, CQRS)  ──►  Dominio (VOs/reglas puras)
        │                              │                               ▲
        │                              ▼                               │
        │                    Puertos (@preztiaos/application)          │
        ▼                              │                               │
  Contracts (ts-rest)        Adaptadores infra (apps/api) ── Drizzle/PG · MinIO · HTTP MP · Gemini
```

### 3.1 Puertos (en `@preztiaos/application`)

| Puerto | Estado | Acción |
|---|---|---|
| `BankPaymentVerifier.verify(pix)` | Existe | Reusar para Inter (per-PIX). **MP no lo implementa.** |
| `BankBalanceProvider.fetchBalance(...)` | Existe | Reusar para Inter. MP devolverá `unavailable` (no hay saldo RT). |
| `PaymentAntifraudService.assess(input)` | Existe | Reusar; **añadir reglas** (ISPB/E2E, recebedor). |
| Extractor IA (`MEDIA_CLASSIFIER`) | Existe | Reusar Gemini (solo extrae + score soft). |
| **`SettlementSourcePort.fetchCredits(window): NormalizedCredit[]`** | **NUEVO** | Abstrae "de dónde salen los ingresos confirmados" (reporte MP). |
| `SecretsPort` | Existe (funciones) | Promover a puerto inyectable si hace falta; reusar [secret-cipher.ts](../apps/api/src/shared/secret-cipher.ts). |

### 3.2 Dominio (en `@preztiaos/domain`)

- Reusar: `FraudAssessment`, `PixReceiptData`, `BankVerificationResult`, `Money` (centavos enteros).
- **Nuevos VO:** `E2EId` (valida longitud/charset/ISPB), `Ispb` (mapea a institución), `NormalizedCredit` (monto en centavos, `sourceId`, `paymentMethodType`, `settlementDate`, `direction`), `ProviderType`.
- **Servicio de dominio puro:** `matchCreditsToClaims(claims, credits)` → consumo idempotente por `sourceId`, match por **monto único**, con invariantes verificables (ver §6).

### 3.3 Adaptadores (en `apps/api`)

- `apps/api/src/payments/banking/mercadopago/`
  - `mp-report.client.ts` — HTTP MP: `POST/PUT /config`, `POST settlement_report`, `GET list`, `GET {file}`. Timeouts + retry/backoff (reusar `fetch-retry`). **Nunca** loggea `access_token`.
  - `mp-settlement.adapter.ts` — implementa `SettlementSourcePort`: descarga CSV, parsea, filtra PIX (`bank_transfer`, `SETTLEMENT_NET_AMOUNT>0`, excluye REFUND/CHARGEBACK), normaliza → `NormalizedCredit[]`. Degrada a vacío/`unavailable` ante fallo.
  - `mp-report-csv.parser.ts` — parser CSV robusto (comillas, comas internas, encabezados según `report_translation` fijado, montos coma/punto).
  - `mp-webhook.verifier.ts` — valida firma **HMAC-SHA256** (`x-signature`, `node:crypto`, compare timing-safe; estrategia configurable con fallback `legacy-bcrypt`), idempotente ante reentregas. Patrón: [whatsapp-signature.ts](../apps/api/src/conversations/whatsapp-signature.ts).
- Registro: agregar MP a un **`SettlementSourceRegistry`** keyed `"BR:MERCADOPAGO"` (mismo patrón que [bank-verifier.registry.ts](../apps/api/src/payments/banking/bank-verifier.registry.ts)). Inter sigue en el verifier per-PIX; MP en el settlement source. Cableado en [payments.module.ts](../apps/api/src/payments/payments.module.ts) (mismo estilo `useFactory(new Map([...]))`).

### 3.4 CQRS (casos de uso)

- **Comandos:** `ConfigureBankProvider` (CRUD + cifrado), `SubmitReceiptClaim` (existe como `SubmitPaymentReceiptHandler` → reusar/extender), `RunReconciliationCycle` (existe `ReconcilePendingPaymentsHandler` → extender para `SettlementSourcePort`), `IngestSettlementWebhook` (nuevo).
- **Queries:** `GetAssessment`, `ListUnconfirmedClaims` (reusar queries de pagos).

---

## 4. Modelo de datos (migraciones Drizzle)

> Regla del repo: **NO escribir SQL/DDL a mano**; editar el schema Drizzle y ejecutar `pnpm db:generate`. Migraciones RLS encadenan snapshot manual (ver memoria [[drizzle-rls-migration-snapshots]]). Próxima migración: **0039+**.

**Decisión recomendada (quirúrgica, no rebuild):** extender `tenant_bank_account` en vez de crear `banks/providers` paralelos (ya cumple el rol de "banco del tenant").

1. **`tenant_bank_account`** ([schema](../packages/db/src/schema/tenant-bank-account.ts)):
   - `+ providerType` enum (`MANUAL` | `INTER` | `MERCADOPAGO`), default `MANUAL`.
   - `+ receiverTaxId` (CPF/CNPJ titular) y `+ receiverName` → match de recebedor (hoy solo `pixKey`).
   - `+ reportConfig jsonb` (prefijo, `report_translation`, timezone, ventana) — config NO secreta.
2. **`bank_credential`** (NUEVA): N secretos por cuenta, **cifrados**.
   - `(id, tenant_id, bank_account_id, name, value_encrypted, created_at, updated_at)`, único `(bank_account_id, name)`. `name ∈ {public_key, access_token, webhook_password}`. `value_encrypted` vía [secret-cipher.ts](../apps/api/src/shared/secret-cipher.ts). RLS FORCE.
   - **Migración del `api_key` legado:** cifrar in-place lo existente (el cipher ya soporta texto plano legado → cifra al re-guardar). El brief exige cifrado en reposo: esto cierra la deuda *"mejora futura: cifrarla"* del schema.
3. **`incoming_credit`** (NUEVA): créditos del `settlement_report` (ground truth).
   - `(id, tenant_id, bank_account_id, source_id, amount_minor, net_amount_minor, currency, payment_method_type, settlement_date, consumed_by_payment_id, raw jsonb, created_at)`.
   - **Único `(tenant_id, source_id)`** → idempotencia de ingestión (no doble consumo). `consumed_by_payment_id` nullable → un crédito valida **un** claim. RLS FORCE.
4. **`seen_e2e` / `seen_receipt_hash`:** **no crear tablas nuevas** — ya cubierto por `payment` (`endToEndId` único + índice `sha256`). Las reglas de dedup ya consultan ahí.
5. **`fraud_assessment`:** evaluar si persistir como tabla propia o seguir embebido en `payment.bankResponse`/status. **Recomendación:** tabla append-only `fraud_assessment (payment_id, phase, status, score, reasons jsonb, created_at)` para trazabilidad (DoD pide "razones trazables") + audit log.

Toda escritura por `withTenantTx`; todo movimiento/decisión al **audit log** append-only.

---

## 5. Pantalla de configuración de bancos (requisito agregado)

**Hoy:** Ajustes → pestaña *Cuentas bancarias* ([bank-accounts-tab.tsx](../apps/mobile/src/features/settings/tabs/bank-accounts-tab.tsx)) que enruta a `/cash/config` ([cash-config-screen.tsx](../apps/mobile/src/features/cash/screens/cash-config-screen.tsx)). El CRUD ya existe en API ([bank-account.controller.ts](../apps/api/src/cash/bank-account.controller.ts), ADMIN + JWT) y contrato ([cash-boxes.ts](../packages/contracts/src/cash-boxes.ts)).

**Plan:** convertir esa pantalla en el **centro de configuración de proveedores/bancos**, manejando el tipo Mercado Pago.

1. **Contrato** ([cash-boxes.ts](../packages/contracts/src/cash-boxes.ts)): extender `bankAccountInput`/`bankAccountPatch`/`bankAccount`:
   - `+ providerType` enum.
   - Credenciales por tipo: para MP → `publicKey` + `accessToken` + `webhookPassword`; para Inter → `apiKey` (compat). **Secretos write-only:** la vista expone solo `hasPublicKey`/`hasAccessToken`/`hasWebhookPassword` (booleanos), **nunca** el valor (igual que `hasApiKey` hoy). `null` borra.
   - `+ receiverTaxId`, `receiverName`, `reportConfig` (prefijo, translation, timezone, ventana).
2. **Pantalla** (Expo Router v56 — leer [docs versionadas](https://docs.expo.dev/versions/v56.0.0/) antes de codear, ver [AGENTS.md](../apps/mobile/AGENTS.md)):
   - Formulario condicional por `providerType`: al elegir **Mercado Pago**, mostrar campos `public_key`, `access_token`, `webhook_password`, identidad del recebedor (llave PIX/CPF-CNPJ/titular) y config de reporte.
   - Secretos: input `secureTextEntry`, placeholder "•••• configurado" cuando `hasAccessToken`, sin precargar el valor. Acción explícita "Reemplazar credencial".
   - Estado del proveedor: badge `unverifiedPolicy` (HOLD/ALLOCATE), botón "Probar credenciales" (llama un endpoint `POST /bank-accounts/:id/verify-credentials` que hace `GET /users/me` en MP — sin exponer el token).
   - Reusar `@preztiaos/ui` (`Card`, `Stack`, `ListItem`, form de `core/form`).
   - RBAC: solo ADMIN (la pestaña ni aparece para Coordinador — patrón ya vigente).
3. **Seguridad UI:** el cliente envía secretos solo en POST/PATCH sobre HTTPS; nunca se devuelven en GET; nunca a logs (front ni back).

---

## 6. Algoritmo de conciliación (Fase 2) — corrección verificable

`matchCreditsToClaims` (dominio puro). **Invariantes (cubiertos por tests):**

- **I1 — No doble consumo:** un `incoming_credit` (por `source_id`) valida **a lo sumo un** `payment`. `Σ claims confirmados por un credit ≤ 1`.
- **I2 — Monto exacto:** un claim solo matchea un credit con **mismo `amount_minor`** (centavos) dentro de la ventana; el "monto único" (centavos únicos por pedido) hace el match determinista.
- **I3 — Filtro PIX recibido:** solo `payment_method_type == bank_transfer`, `net_amount_minor > 0`, excluyendo REFUND/CHARGEBACK.
- **I4 — Idempotencia de ingestión:** reingestar el mismo `source_id` (re-poll o reentrega de webhook) **no** crea créditos ni consume de nuevo (índice único + upsert no-op).
- **I5 — Sin crédito → UNCONFIRMED:** tras la ventana sin match, el claim queda `UNVERIFIED` (no se libera) y escala a revisión.
- **I6 — Decisión solo por ground truth:** `APPROVE` ⇔ existe match con crédito real. La IA **nunca** mueve esto (peso blando, AUC≈0.5).

**Pipeline completo:**

```
Fase 1 (síncrona, barata, determinista):
  extracción IA → E2E bien formado? (long/charset/ISPB→institución) ─ no ─► REJECT
                → E2E ya visto? (payment.end_to_end_id) ─ sí ─► REJECT
                → imagen ya vista? (payment.sha256) ─ sí ─► REJECT
                → recebedor == identidad configurada? ─ no ─► REJECT
                → sanidad temporal (futuro/viejo) ─► REVIEW/REJECT
                → score IA soft (manipulación/EXIF) ─► alerta + REVIEW (no decide)
  ⇒ si pasa: claim queda RECEIVED/UNVERIFIED (HOLD: no abona aún)

Fase 2 (asíncrona, ground truth):
  RunReconciliationCycle ──► SettlementSourcePort.fetchCredits(window)
       (poll on-demand o disparado por webhook "reporte listo" BCrypt)
   → filtra PIX (I3) → matchCreditsToClaims (I1,I2,I4) en transacción
   → match: CONFIRMED → recién aquí se libera (abona cuotas)
   → sin match tras ventana: UNCONFIRMED (no liberar; revisión)
```

---

## 7. Plan de ejecución por incrementos (verificables)

> Spec (Gherkin) → prueba de dominio → implementación. Cada incremento: typecheck + lint + test + build verdes.

| # | Incremento | Entregable | Verificación |
|---|---|---|---|
| **0** | **Validación documental MP** ✅ | [VALIDATION_MERCADOPAGO_PIX.md](VALIDATION_MERCADOPAGO_PIX.md) | Hecha 2026-06-29 |
| **1** | **Cifrado de credenciales** ✅ | `bank_credential` (schema + migración 0039 con RLS) + `BankCredentialDrizzleRepository`; `api_key` legado ya cifrado (cipher con passthrough); comentario stale corregido | typecheck+lint+unit ✅; **integración verde contra PG real** (cifrado en reposo, RLS, upsert idempotente) |
| **2** | **`providerType` + identidad recebedor + `reportConfig`** ✅ | enum `bank_provider_type` (MANUAL/INTER/MERCADOPAGO) + `receiver_tax_id`/`receiver_name` + `report_config` jsonb; migración 0040 (con backfill INTER); contrato (`bankProviderType`/`bankReportConfig` + view/input/patch); repo create/update/view | typecheck (db+contracts+api+mobile)+lint+unit ✅; **integración verde** (round-trip MP + default MANUAL) |
| **3** | **Pantalla de configuración de bancos (MP)** ✅ | credenciales como agregado atómico (cuenta+`bank_credential` en 1 tx); view `hasPublicKey/hasAccessToken/hasWebhookSecret` (write-only); endpoint `POST /bank-accounts/:id/verify-credentials` + `MercadoPagoAccountClient` (`GET /users/me`); screen condicional por `providerType` (recebedor + secretos + reportConfig + "Probar credenciales") | typecheck (contracts+api+mobile)+lint+unit ✅; **migraciones 0039/0040 aplicadas + integración verde (17/17)** |
| **4** | **Reglas Fase 1 nuevas** ✅ | dominio puro `analyzeE2EId` + `KNOWN_ISPB` (códigos verificados) + `matchReceiver`; reglas `E2EWellFormedRule` (pura) + `ReceiverMatchRule` (DB) en el composite | domain vitest 239 (13 nuevos) + api unit 24 (+4) + integración 20 (+3 recebedor, DB+RLS) ✅ |
| **5** | **`SettlementSource` + dominio match** ✅ | puerto `SettlementSource`/`SettlementWindow`; `NormalizedCredit` + `isEligiblePixCredit` + `matchCreditsToClaims`; tabla `incoming_credit` (migración 0041, RLS) + `IncomingCreditDrizzleRepository` (ingest idempotente, listUnconsumed, markConsumed atómico) | property test I1–I6 + domain 251 + integración 24 (ingest idempotente, consumo atómico, RLS) ✅; 0041 aplicada |
| **6** | **Adaptador MP (cliente + parser CSV + adapter)** ✅ | `mp-report-csv.parser.ts` (puro), `mp-report.client.ts` (config→create 202→poll→download, defensivo), `mp-account-context.reader.ts`, `mp-settlement.adapter.ts` (implements `SettlementSource`, filtra I3); registro `SETTLEMENT_SOURCE` con `BR:MERCADOPAGO` | jest 42 (parser 13 + adapter 5); HTTP mockeado vía fetcher fake; DI graph boot OK |
| **7** | **Webhook reporte (HMAC-SHA256) + ingestión idempotente** ✅ | `mp-webhook.verifier.ts` (HMAC-SHA256 node:crypto, estrategia configurable), `mp-webhook-context.reader.ts`, `IngestSettlementWebhookService` (verify→fetch→ingestMany idempotente), `MercadoPagoWebhookController` (`POST /webhooks/mercadopago/:tenantId`, público/HMAC) | jest 53 (verifier 7 + handler 4: válida/secreto-errado/id-manipulado/cabecera/reentrega); DI boot OK |
| **8** | **Ciclo de conciliación end-to-end** ✅ | `confirmWithCredit` (consume+verifica atómico, FOR UPDATE) + `applyAllocationTx` compartido; `findSettlementAccount`; `RunSettlementReconciliationService` (fetch→ingest→match→confirm→notify); endpoint `/payments/reconcile-settlement`; audit log (`payment_confirmed_by_settlement`) | integración 27 (ciclo completo CSV→confirm; **falso perfecto→UNCONFIRMED**; idempotencia) + DI boot ✅ |
| **9** | **Seeds/fixtures + README** ✅ | fixtures (`settlement-report.sample.csv` + `receipts.fixture.ts` 6 casos + spec 9 tests); seed `seed:mercadopago` (banco MP + credenciales cifradas + comprobantes + créditos); [README](MERCADOPAGO_PIX.md) | seed corre y puebla (verificado); unit 62 + integración 27 ✅ |

---

## 8. Testing y datos de prueba (requisito duro)

- **Unit por señal** (Fase 1): E2E malformado, ISPB inválido/inexistente, E2E reusado, recebedor no coincide, fecha incoherente, imagen duplicada. Reusar estilo de [payment-antifraud.service.ts](../apps/api/src/payments/payment-antifraud.service.ts).
- **Parser CSV:** comillas, comas internas, encabezados según `report_translation` fijado, montos coma/punto, filas de débito/refund.
- **Filtro PIX:** incluye `bank_transfer` crédito; excluye tarjeta, retiro/débito, REFUND/CHARGEBACK.
- **Property test idempotencia (I1–I5):** N comprobantes con el mismo monto único **no** pueden validar contra un único crédito; un segundo crédito real válido sí valida un segundo pedido; sin crédito → UNCONFIRMED.
- **Webhook BCrypt:** firma válida, password errado, payload manipulado; idempotencia ante reentrega.
- **Integración:** ciclo completo con **fixtures CSV sintéticos** (sandbox devuelve vacío). HTTP de MP **mockeado** (no red).
- **Seeds:** 1 tenant + banco MP configurado (credenciales de ejemplo, **no reales**), comprobantes (válido, E2E malformado, E2E reusado, recebedor erróneo, monto que matchea, monto sin match) + `settlement_report.csv` consistente.
- **Caso estrella:** "comprobante falso perfecto" → debe terminar **UNCONFIRMED/REJECT** por ausencia de crédito real.

---

## 9. Restricciones y "no hagas" (del brief + repo)

- **Nunca** liberar contra la imagen del comprobante; solo contra el crédito real del reporte (Fase 2).
- IA = **filtro soft** de primer nivel (alertas + score), **nunca** juez de autenticidad ni autorizador (AUC≈0.5; ver [analisisPlataformas.md](analisisPlataformas.md)).
- **No** hardcodear identificación de banco ni llaves; todo configurable y **cifrado**.
- **No** loggear secretos (`access_token`, `webhook_password`) ni PII (payer_tax_id/name). Reusar [sanitize.ts](../apps/api/src/observability/sanitize.ts).
- **No** confiar en `EXTERNAL_REFERENCE` para transferencias libres (viene vacío).
- **No** asumir que el sandbox pobla el reporte (sale vacío) → fixtures.
- **No** doble consumo de un crédito (`source_id` único + transacción).
- **No** agregar dependencias nuevas sin autorización (CLAUDE.md). Firma del webhook resuelta con **HMAC-SHA256 (`node:crypto`)** → **sin dependencia nueva**. Solo si se confirma BCrypt legado contra una notificación real se evaluaría una lib (con autorización).
- **Cambios quirúrgicos:** extender costuras existentes (registries, composite, settings tab), no refactor cosmético.

---

## 10. Definición de Hecho (DoD)

- [x] `VALIDATION.md` punto por punto (§1) → [VALIDATION_MERCADOPAGO_PIX.md](VALIDATION_MERCADOPAGO_PIX.md).
- [x] Migraciones Drizzle (0039 bank_credential, 0040 providerType/recebedor/reportConfig, 0041 incoming_credit) + VO de dominio (`E2EId`/`analyzeE2EId`, `matchReceiver`, `NormalizedCredit`/`matchCreditsToClaims`).
- [x] `SettlementSource` + `MercadoPagoSettlementAdapter` (poll + webhook firmado HMAC-SHA256).
- [x] Motor validador Fase 1 (E2E/ISPB + recebedor + dedup) + Fase 2 (match + confirmación atómica) con razones trazables (audit log `payment_confirmed_by_settlement`).
- [x] Config de banco/llaves end-to-end (CRUD + cifrado) multi-tenant + pantalla de configuración.
- [x] Suite unit + integración + property **verde**, con fixtures y seeds.
- [x] README: [MERCADOPAGO_PIX.md](MERCADOPAGO_PIX.md) (configurar, correr, probar sin sandbox, supuestos pendientes).
- [x] typecheck + lint + test verdes.
- [x] **Tabla `fraud_assessment` propia** (append-only, RLS, migración 0042): traza estructurada de Fase 1 (`PHASE1_SCREEN`: status/score/reasons en `savePaymentOutcome`) y Fase 2 (`PHASE2_SETTLEMENT`: CONFIRMED en `confirmWithCredit`), en la misma transacción.

---

## 11. Decisiones abiertas (requieren confirmación)

1. **Modelo de datos:** ¿extender `tenant_bank_account` + `bank_credential` (recomendado, quirúrgico) o crear `banks/providers` separados como literal del brief? → **Recomiendo extender.**
2. ~~**BCrypt:** ¿algoritmo de firma del webhook MP?~~ **RESUELTO** (VALIDATION.md): es **HMAC-SHA256**, `node:crypto`, sin dependencia. Pendiente menor: confirmar si la notificación específica de "reporte listo" usa el esquema legado BCrypt contra una notificación real.
3. ~~**Tabla `fraud_assessment` propia** vs seguir en `payment`~~ **RESUELTO**: tabla propia append-only (migración 0042), recordada en Fase 1 (`savePaymentOutcome`) y Fase 2 (`confirmWithCredit`) vía `recordFraudAssessmentTx`.
4. **Alcance KYB/terceros (Camino C):** ¿se aborda ahora o ADR aparte? → **Recomiendo ADR aparte**, fuera de la integración MP.
