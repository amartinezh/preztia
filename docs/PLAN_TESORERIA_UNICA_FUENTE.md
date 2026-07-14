# Plan — Tesorería como única fuente de verdad del dinero

> **Objetivo:** eliminar la liquidación y toda agregación paralela de caja. El dinero se maneja
> con un modelo **simple pero contundente**: cada peso que se mueve es un asiento en el libro
> mayor de cajas; los saldos (banco y efectivo) se derivan del libro; la verificación es
> **continua** (arqueo + conciliación bancaria), no un cierre periódico. Prioridad #1: **no
> perder dinero** — saldos siempre reales, cuadrados y verificables en todo momento.

---

## 1. Principio rector

**Una sola fuente de verdad para el dinero: el libro mayor de cajas (`cash_transaction` + `cash_box`).**

Separación de responsabilidades (SRP a nivel sistema):

- **Tesorería** — *¿dónde está el dinero y está cuadrado?* → **solo** el libro de cajas. Todo
  saldo se deriva de `Σ IN − Σ OUT`. Nadie más calcula una "caja".
- **Reportería / P&L** — *¿cómo va el negocio?* → read-models sobre cartera (créditos, cuotas,
  abonos, gastos). Son vistas derivadas; **nunca** producen un saldo de caja independiente.

**Invariante central (por caja):** `saldo = Σ IN − Σ OUT ≥ 0`. El dinero solo entra/sale por
asientos, y cada asiento nace de un **gesto humano confirmado** o de una **regla del sistema
idempotente**. No hay forma de mover dinero "por fuera" del libro.

---

## 2. Diagnóstico del estado actual (verificado en código)

| Flujo | Estado hoy | Archivo |
|---|---|---|
| Pago PIX entrante → caja | ✅ `PAYMENT_IN` a caja BANK por llave PIX (o `UNIDENTIFIED` a Tránsito) | `apps/api/src/cash/payment-box-router.ts` |
| **Desembolso (crédito aprobado)** | ❌ crea crédito `ACTIVE`, **no debita caja** | `apps/api/src/credit-application/review/application-decision.repository.ts:50` |
| **Gasto aprobado** | ❌ solo `status = APPROVED`, **no debita caja** | `apps/api/src/cash/cash.controller.ts:104` |
| Cobro en **efectivo** | ⚠️ sin ruta a caja `CASH`; cae en Tránsito | `payment-box-router.ts:41` |
| **Liquidación** (escalar paralelo) | ⛔ recalcula caja desde `payment_allocation + credit.principal + expense`, diverge del libro | `apps/api/src/cash/settlement.repository.ts:42` · `packages/application/src/cash/settlements.ts` |
| **Reporte diario** | ⚠️ misma agregación paralela; mezcla cartera con "caja del día" | `apps/api/src/cash/cash-query.repository.ts:338` |

**Consecuencia:** el libro solo conoce la mitad del ciclo (entra dinero, nunca sale al prestar/
gastar) → las cajas se **inflan**. La liquidación existía porque era el único lugar que restaba
lo prestado. La solución no es la liquidación: es **cerrar el ciclo en el libro**.

Nota: el "control total del dinero" (dashboard de saldos por caja, liquidez, tránsito, arqueo,
sync bancaria) **ya existe** — `cashBoxesContract` + `cash-boxes-screen.tsx` + `GET /cash/dashboard`.
El trabajo es **completar el libro** y **retirar la liquidación**, no construir tesorería de cero.

---

## 3. Modelo objetivo — el ciclo completo del dinero

```
                      ┌─────────────────── LIBRO DE CAJAS (única verdad) ───────────────────┐
Cliente pide (WhatsApp)│                                                                     │
   → depuración IA     │   CASH boxes    BANK boxes (cuentas)     TRANSIT box                │
   → humano 1 click    │       │              │                      │                       │
      APRUEBA ─────────┼─ OUT DISBURSEMENT ───┤ (elige caja/cuenta origen; saldo ≥ monto)    │
      (envía dinero)   │       ▼              ▼                                              │
                       │   saldo baja      saldo baja                                        │
Sistema cobra          │                                                                     │
Cliente paga (PIX)     │                                                                     │
   → conciliación      │                                                                     │
   → humano 1 click    │                                                                     │
      CONFIRMA ────────┼─ IN PAYMENT_IN ─────►│ (BANK por PIX) / │►CASH (cobrador) / Tránsito │
                       │                      ▲ saldo sube                                    │
Gasto operativo        │                                                                     │
   → humano aprueba ───┼─ OUT EXPENSE ───────►│ (elige caja pagadora)                        │
                       │                                                                     │
Verificación continua  │   Arqueo (conteo físico) + Sync bancaria  → descuadre visible ya    │
                       └─────────────────────────────────────────────────────────────────────┘
```

Asientos (`cash_tx_kind`): `PAYMENT_IN`, **`DISBURSEMENT`** (nuevo), `EXPENSE`, `WITHDRAWAL`,
`TRANSFER`, `ADJUSTMENT`, `UNIDENTIFIED`. Todos idempotentes y atómicos con el hecho de negocio
que los origina (crédito, pago, gasto). Nada de liquidación, nada de escalar paralelo.

---

## 4. Plan por fases

### Fase 0 — Cimientos de esquema ✅ (implementada)

- **`packages/db/src/schema/cash-transaction.ts`**: `DISBURSEMENT` agregado al enum `cash_tx_kind`.
- **Traza de origen**: en lugar de `credit.disbursement_tx_id`, se añadió `cash_transaction.credit_id`
  (referencia a `credit.id`), **simétrico** con las trazas `payment_id`/`expense_id` que ya existían.
  El libro apunta a su origen; no se toca la tabla `credit`.
- **Índice único parcial `cash_tx_credit_idx`** (`where credit_id is not null`): un crédito → un solo
  asiento `DISBURSEMENT` (idempotencia), espejo del `cash_tx_payment_idx`.
- **Drop de `settlement`**: **movido a Fase 4** — dropear la tabla ahora rompería el build porque el
  código de liquidación aún la referencia. En Fase 0 solo cambios **aditivos**.

**Pendiente del usuario:** `pnpm db:generate` → revisar el SQL (el `ALTER TYPE … ADD VALUE` del enum
va aislado; ojo con el chaining de snapshots RLS) → `pnpm db:migrate`.

---

### Fase 1 — Desembolso: el dinero SALE de una caja/cuenta (el gap principal) ✅ (implementada)

> Implementado: `assertCanPost` (dominio, ya existía) reutilizado con intent `DISBURSEMENT`;
> `fundingCashBoxId` en `approveApplicationInput`; puerto `approveAndGrant` extendido; poster
> `apps/api/src/cash/disbursement-poster.ts` (lock → saldo → `assertCanPost` → asiento OUT) llamado
> dentro de la misma tx de `approveAndGrant`; selector "Desembolsar desde" en `decision-modal.tsx`.
> Verde en build + typecheck + test. **Falta:** aplicar la migración (`pnpm db:generate/migrate`).


Cerrar la mitad faltante del ciclo. Al aprobar+enviar, se debita la caja/cuenta de origen de forma
atómica con el otorgamiento.

- **Dominio** (`packages/domain`): función pura `assertSufficientBalance(saldo, monto)` /
  invariante de caja `saldo ≥ 0`; `DomainError('INSUFFICIENT_CASH_BOX_BALANCE')`. Sin I/O.
- **Contracts** (`packages/contracts/src/credit-application-review.ts`): `approveApplicationInput`
  gana `fundingCashBoxId: uuid` (caja/cuenta de origen del desembolso). Validación en la frontera.
- **Application** (`packages/application`): `ApproveApplicationReviewHandler` orquesta:
  transición → crédito+cronograma → **asiento `DISBURSEMENT` (OUT)** por el puerto de tesorería.
  Nuevo puerto `TreasuryLedgerPort.postDisbursement({ cashBoxId, amountMinor, creditId, ... })`
  (definido por la aplicación, implementado por infraestructura — inversión de dependencias).
- **API** (`application-decision.repository.ts`): dentro de la **misma** `withTenantTx` de
  `approveAndGrant`:
  1. lee saldo de la caja origen (reusa `cash-ledger.ts`); si `saldo < principal` → **409**, aborta
     todo (no queda crédito activo sin egreso).
  2. inserta el asiento `DISBURSEMENT` OUT (idempotente por `credit_id`).
  3. persiste `credit.disbursement_tx_id`.
  Un solo commit: **imposible** un crédito `ACTIVE` sin su salida de caja.
- **Mobile** (`applications-review`): la pantalla de aprobación añade un selector **"Desembolsar
  desde"** (lista de cajas CASH + cuentas BANK con su saldo, desde `GET /cash/dashboard`), con el
  saldo resultante en vivo. Deshabilitar aprobar si el saldo no alcanza.

**Invariantes/pruebas:** desembolso sin saldo → 409 y cero efectos; con saldo → crédito `ACTIVE`
+ asiento OUT + saldo caja baja exactamente `principalMinor`; reintento (misma Idempotency-Key)
→ un solo asiento; el evento va al audit log.

> **Confirmado (Decisión A):** **un gesto** — aprobar exige `fundingCashBoxId` y postea el egreso
> en la misma transacción; el crédito nace `ACTIVE` y fondeado. No hay estado intermedio.

---

### Fase 2 — Cobro: el dinero ENTRA por confirmación humana

Alinear el posteo `PAYMENT_IN` al gesto humano ("verifico → 1 click → entra a la caja").

**Confirmado (Decisión B): todo el cobro es PIX por ahora** — se omite la ruta a caja `CASH` del
cobrador. Las cajas `CASH` sirven solo como origen de desembolsos/gastos (caja de oficina).

- **PIX / rieles bancarios:** el `PAYMENT_IN` ya se postea al pasar el pago a `VERIFIED`
  (`credit-portfolio.repository.ts:162`). Ajustar para que **el gesto de confirmación humana sea
  exactamente lo que transiciona a `VERIFIED`** (y por ende postea al libro), no un paso previo
  automático. La conciliación *propone* el match; el humano *confirma* → asiento.
- **Contracts/Mobile:** el botón "Confirmar" de conciliación/pago refleja la caja destino y el
  saldo resultante. Sin cambios de esquema (el asiento ya existe).
- *(Futuro, si aparece efectivo de cobradores)* ruta en `payment-box-router.ts`: postear
  `PAYMENT_IN` a la caja `CASH` del cobrador (`cash_box.assigned_to`). Fuera de alcance ahora.

**Invariantes/pruebas:** confirmar un pago verificado → un solo `PAYMENT_IN` (idempotente por
`payment_id`, ya garantizado por `cash_tx_payment_idx`); pago no confirmado → **no** hay dinero en
caja.

> **✅ Implementada.** Hallazgo: la verificación **manual** (`ManualVerifyPaymentRepository.verify`,
> el click humano) ponía el pago en `VERIFIED` y aplicaba abonos pero **NO** posteaba al libro (a
> diferencia de los paths automáticos). Ahora, en la misma tx de la confirmación, llama a
> `routeVerifiedPaymentToBox` → el dinero entra a su caja (BANK por PIX / Tránsito). El click humano
> es lo que hace entrar el dinero. Idempotente por `cash_tx_payment_idx`. Verde en las 4 compuertas.

---

### Fase 3 — Gastos: el dinero SALE de una caja pagadora ✅ (implementada)

- **Contracts** (`expenses.ts`): `reviewExpenseInput` gana `paidFromCashBoxId: uuid` (obligatorio al
  aprobar vía `superRefine`; rechazar no lleva caja).
- **Application/API** (`ReviewExpenseHandler` + `expense.repository`): al aprobar, en la MISMA tx:
  `status = APPROVED` + asiento **`EXPENSE` (OUT)** en la caja pagadora (fail-fast de saldo).
- **Mobile** (`cash-screen` sección Gastos): selector "Pagar desde" (aparece si hay gastos
  pendientes); botón Aprobar deshabilitado hasta elegir caja. **Bug corregido de paso:** el
  `currency="COP"` hardcodeado del listado de gastos ahora usa la moneda del dashboard.
- **DRY**: el poster de Fase 1 se generalizó a **`apps/api/src/cash/cash-out-poster.ts` →
  `postCashOut`** (punto ÚNICO de control de las salidas de dinero: lock → saldo → `assertCanPost` →
  asiento), reutilizado por desembolso y gasto. Idempotencia por `cash_tx_expense_idx` (nuevo).

**Invariantes:** aprobar gasto → asiento OUT + saldo baja; rechazar → sin efectos de caja; sin
saldo → falla toda la tx (sin gasto aprobado sin egreso). Verde en build+typecheck+test+lint.
**Falta:** aplicar la migración (`pnpm db:generate/migrate`) — incluye el índice `cash_tx_expense_idx`.

---

### Fase 4 — Eliminar la liquidación y la doble agregación ✅ (implementada)

> **✅ Implementada.** Borrados: `settlements.ts` (contract), `computeCajaActual` (dominio),
> `cash/settlements.ts` + `SettlementStore` (app), `settlement.repository.ts` + 3 endpoints
> (`cash.controller`) + provider (`cash.module`) + `listSettlements` (`cash-query`), `schema/settlement.ts`
> (tabla), `SettlementSection` + hooks (mobile). **Entrelazamiento resuelto** (decisión del usuario:
> período = **hoy**): el `cashCurrentMinor` del dashboard ahora es la **liquidez real del libro**
> (Σ CASH+BANK); `unsettledMinor` ("Sin Liquidar") → **`collectedTodayMinor`** ("cobrado hoy") en
> cuentas; `dueSinceLastSettlementMinor`/`paidSinceLastSettlementMinor` → **`dueTodayMinor`/`paidTodayMinor`**
> en el reporte por deudor (+ `currency`, corrige otro `COP` hardcodeado). Verde en las 4 compuertas.
> **Falta la migración** que dropea la tabla `settlement` (`pnpm db:generate/migrate`).

Borrado quirúrgico del escalar paralelo (nada de legacy que conservar):

- **Contracts:** eliminar `packages/contracts/src/settlements.ts` y su export en `index.ts`.
- **Dominio:** eliminar `computeCajaActual`.
- **Application:** eliminar `packages/application/src/cash/settlements.ts`, `SettlementStore` de
  `cash/ports.ts`, y sus tests.
- **API:** eliminar `cash/settlement.repository.ts` y los endpoints de liquidación en
  `cash.controller.ts`; quitar el registro en `cash.module.ts`.
- **DB:** drop tabla `settlement` (Fase 0) — cuidar `tenant-data-purge.repository.ts`.
- **Mobile:** eliminar `SettlementSection` e historial de liquidadas de `cash-screen.tsx` y los
  hooks `useSettlementPreview/useCloseSettlement/useSettlementsList`.
- **Reporte diario → read-model de cartera:** conservarlo como **P&L/actividad** (cobrado,
  prestado, gastos, cuentas nuevas/terminadas) pero rotulado como *reportería del negocio*, no
  como "caja". El saldo de dinero se lee **solo** del dashboard de tesorería. (Evalúa si el número
  "caja del día" se elimina o se re-deriva del libro para que ambos siempre coincidan.)

**Bug puntual a corregir de paso:** `cash-screen.tsx:142` y `:202` hardcodean `currency="COP"`
(el tenant es BRL). Al reconstruir la pantalla, usar la moneda del dashboard/tenant.

---

### Fase 5 — Pantalla de Caja = Tesorería (reutilizar lo existente) ✅ (implementada)

> **✅ Implementada.** La pestaña Caja ahora lidera con un **`TreasurySummaryCard`** (liquidez real
> del libro, efectivo, banco y alerta de tránsito, desde `GET /cash/dashboard`) + botón "Ver cajas y
> cuentas" que profundiza al detalle existente (saldos por caja, arqueo, conciliación, movimientos —
> ya con `DISBURSEMENT`/`EXPENSE` en el libro). Debajo, el reporte diario (P&L) y los gastos. No se
> construyó tesorería de cero: se reusó el dashboard. Verde en las 4 compuertas.

La pestaña "Caja" deja de mostrar Reporte diario + Liquidada y pasa a ser la **vista de control
total del dinero** (que ya existe como "Cajas y cuentas"):

- Saldo total, **efectivo total** (Σ CASH), **dinero bancario total** (Σ BANK), **liquidez**.
- Saldo por caja/cuenta + estado de última conciliación/arqueo (descuadres resaltados).
- Alerta de **Tránsito > 0** (dinero sin identificar) — acción para clasificarlo (transferencia).
- Libro de movimientos con filtros (ya existe `listCashTransactions`), ahora **completo** (incluye
  `DISBURSEMENT` y `EXPENSE`).
- Acciones de verificación: **Arqueo** (conteo físico de una caja CASH) y **Sync** (saldo real del
  banco) — ya existen en el contrato.

Sin liquidación: la "confianza" viene de que el libro está **siempre cuadrado y verificable**.

---

### Fase 6 — Correctitud y CI verde ✅ (parcial)

> **✅ CI verde** (build · typecheck · test · lint) tras todas las fases. Añadida una **prueba de
> dominio de cuadre** (`cash-box.test.ts`, "conservación del dinero"): aplica desembolso/cobro/gasto
> con `assertCanPost` (sin sobregiro) y verifica `Σ saldos = inicial − desembolsos + cobros − gastos`.
> El invariante `saldo ≥ 0` ya estaba cubierto; idempotencia por índices únicos.
> **Pendiente (requiere DB):** la **prueba de cuadre e2e** de integración y la **verificación real**
> (`/verify`) exigen aplicar la migración primero (`pnpm db:generate/migrate`).

- **Invariantes con pruebas:** `saldo ≥ 0` en toda salida; atomicidad crédito↔desembolso y
  gasto↔egreso (fallo total ante saldo insuficiente); idempotencia de los tres asientos
  (`DISBURSEMENT` por crédito, `PAYMENT_IN` por pago, `EXPENSE` por gasto); audit log append-only
  de todo movimiento y cambio de estado.
- **Prueba de cuadre end-to-end:** partir de saldos conocidos → desembolsar, cobrar, gastar →
  `Σ saldos de cajas` = `saldo_inicial − desembolsos − gastos + cobros`. La tesorería cuadra sola.
- **Verificación real** (`/verify`): recorrer aprobar→desembolsar→cobrar→confirmar→gasto y observar
  los saldos moverse en el dashboard.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.

---

## 5. Impacto por paquete (mapa rápido)

| Capa | Alta | Baja / cambio |
|---|---|---|
| `packages/db` | enum `DISBURSEMENT`, `credit.disbursement_tx_id`, migraciones | **drop** tabla `settlement` |
| `packages/domain` | `assertSufficientBalance` / invariante caja | **drop** `computeCajaActual` |
| `packages/contracts` | `fundingCashBoxId`, `paidFromCashBoxId` | **drop** `settlements.ts` |
| `packages/application` | `TreasuryLedgerPort`, orquestación desembolso/gasto | **drop** `cash/settlements.ts`, `SettlementStore` |
| `apps/api` | posteo `DISBURSEMENT`/`EXPENSE`, ruta CASH del cobro, saldo fail-fast | **drop** `settlement.repository.ts` + endpoints |
| `apps/mobile` | selector "desembolsar desde" / "pagar desde", pantalla Tesorería | **drop** `SettlementSection`, hooks de liquidada |

---

## 6. Decisiones confirmadas

- **A. Desembolso = un gesto.** Aprobar exige `fundingCashBoxId` y postea el egreso `DISBURSEMENT`
  en la misma transacción que otorga el crédito; nace `ACTIVE` y fondeado. Sin estado intermedio.
- **B. Todo el cobro es PIX (por ahora).** Se omite la ruta a caja `CASH` del cobrador; las cajas
  `CASH` son solo origen de desembolsos/gastos (caja de oficina). La ruta CASH queda como futuro.
- **C. Reporte diario se conserva** como P&L / actividad de cartera, claramente separado de
  tesorería (el saldo de dinero se lee solo del dashboard de cajas).
