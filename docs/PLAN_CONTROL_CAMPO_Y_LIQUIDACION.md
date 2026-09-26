# Plan — Control de campo del cobrador y liquidación por períodos

> **Objetivo:** que la dirección (empresa o zona) vea, en tablas claras, **todo lo que pasó con la
> plata** desde la última liquidación y el histórico de liquidaciones anteriores, y que el
> **cobrador quede auditado y controlado** en cada peso que toca: órdenes de ruta, rendición
> diaria, consignaciones y gastos, con trazabilidad completa (quién, qué, cuándo).
>
> **Principio no negociable:** la liquidación es una **fotografía sellada del libro de cajas**
> (`cash_transaction`), nunca un cálculo paralelo. La liquidación anterior se **borró** en julio
> precisamente por recalcular caja por su cuenta y divergir del libro
> ([PLAN_TESORERIA_UNICA_FUENTE.md](PLAN_TESORERIA_UNICA_FUENTE.md)). Este plan no la resucita.
>
> **Estado:** **plan completo — Fases 1–7 implementadas y verificadas** contra Postgres real
> (migraciones 0057–0066 aplicadas en local, con RLS a mano en 0059, 0062, 0064 y 0066; integración
> 75/75). Nada aplicado aún en producción: se desplegará todo junto tras la verificación en local.
> **ADR:** #41 registrado en [ARCHITECTURE.md](ARCHITECTURE.md) (ver §9).

---

## 1. Requisito y decisiones acordadas

Requisito original del cliente: *liquidación por períodos configurable (semanal, quincenal,
mensual); ver al día de hoy qué plata entró y qué plata salió desde la última liquidación; ver
fotografías de liquidaciones anteriores y estadísticas de cómo les fue por período; información en
tablas claras para dirigir la empresa o la zona.*

En la conversación de diseño se amplió al **control de campo del cobrador**. Decisiones cerradas:

| Tema | Decisión |
|---|---|
| **Liquidación** | Fotografía sellada del libro por período. **No se reabre**; toda corrección posterior cae en el período siguiente, referenciando el período que corrige. |
| **Período** | Configuración **del tenant** (forma de trabajar): `WEEKLY` / `BIWEEKLY` / `MONTHLY`, con día de corte. |
| **Cierre** | Automático por **cron por tenant**, con bandera `autoClose` que lo prende/apaga. Con la bandera apagada, el ADMIN cierra a mano. |
| **Retroactivos** | Sí: liquidaciones de períodos pasados calculadas desde el libro, marcadas `retroactive`. (Aún no hay producción, así que el libro estará completo desde el día 1.) |
| **Zonas** | Cada zona maneja sus cajas; las **zonas hijas pueden usar las cajas de sus ancestros**. Atribución de cada movimiento a su zona **por origen** (no por caja). |
| **Utilidad** | **Interés ganado vs. capital recuperado**: cada abono lleva capital e interés en la **misma proporción del crédito**. |
| **Visibilidad** | ADMIN ve todo · COORDINATOR solo su **subárbol de zonas** · COLLECTOR **no ve liquidaciones**; ve solo sus órdenes, su rendición y **todo su historial**. |
| **Rendición del cobrador** | **Diaria**, al volver de ruta. Hora límite configurable por tenant (ej. 20:00 local). **Exento** si ese día no tuvo ruta ni movió efectivo. |
| **Entrega** | Efectivo al coordinador (**caja de oficina de la zona**), confirmado con conteo de quien recibe. |
| **Consignación** | El coordinador ve el efectivo en la calle y **ordena** al cobrador depositar un monto; el cobrador reporta (cuándo, a qué cuenta, cuánto) con **foto de comprobante obligatoria**; el coordinador verifica contra la cuenta PIX. |
| **Deuda del cobrador** | El faltante de la rendición es **deuda** y **se arrastra**. Se descuenta de la nómina (fuera del sistema por ahora). Cierre de deuda solo ADMIN con motivo, en dos tipos: **recuperado por nómina** (no afecta utilidad) y **condonado** (pérdida, resta de la utilidad). |
| **Gastos** | Los solicita el cobrador desde su perfil con **foto obligatoria**; el coordinador aprueba **eligiendo la caja** de la que sale el dinero o rechaza **con motivo**; fecha y hora de todo; historial para ambos. |
| **Rutas** | El sistema **propone** la ruta; el coordinador **reparte las paradas** entre uno o varios cobradores y con un botón les da la orden. El cobrador **liquida cada visita**: *pagó (monto) / no pagó + motivo / promesa de pago con fecha / no encontrado*. |
| **Acceso en ruta** | El cobrador solo ve clientes de su cartera. Una parada de un cliente **no asignado** le da una **vista mínima y temporal**: nombre, dirección y mapa, teléfono y **monto a cobrar en esa visita**. Nunca saldo total, historial ni la cartera de la ruta. Al cerrar la parada pierde el acceso. |
| **Trazabilidad** | Cada orden tiene una **bitácora append-only** (emitida, vista, reportada, verificada, objetada, comentarios) con fecha, hora y actor: es la herramienta de comunicación para cuadres y malentendidos. |

---

## 2. Diagnóstico del estado actual (verificado en código)

### 2.1 Qué ya existe y se reutiliza

| Pieza | Dónde | Uso en este plan |
|---|---|---|
| Libro append-only `cash_transaction` (IN/OUT, kinds, trazas a pago/crédito/gasto/arqueo) | `packages/db/src/schema/cash-transaction.ts` | Única fuente de la liquidación y de la rendición |
| Caja de ruta: `cash_box` CASH con `assigned_to` (cobrador) | `packages/db/src/schema/cash-box.ts` | **Cuenta del cobrador**: efectivo en su poder = deuda si no rinde |
| Poster único de salidas `postCashOut` (lock → saldo → `assertCanPost` → asiento) | `apps/api/src/cash/cash-out-poster.ts` | Gastos, entregas, consignaciones, cierres de deuda |
| Arqueo + ajuste por descuadre | `cash/boxes/:id/count`, `cash/boxes/:id/adjust` | Conteo del coordinador al recibir la entrega |
| Gastos con aprobación y caja pagadora (`paidFromCashBoxId`) | `packages/contracts/src/expenses.ts`, `apps/api/src/cash/expense.repository.ts` | Base de las solicitudes de gasto v2 |
| Ruta óptima OSRM + clientes críticos | `apps/api/src/collections/osrm-route-optimizer.ts`, `critical-clients.repository.ts` | Propuesta de ruta |
| Regla "necesita visita" por mora (umbral único) | `packages/domain/src/credit/collection/visit-policy.ts` | Selección de paradas propuestas |
| Bitácora de visitas `collection_visit` / `collection_note` (append-only) | `packages/db/src/schema/collection-visit.ts`, `collection-note.ts` | Resultado de cada parada |
| Cartera del cobrador `collector_client` | `packages/db/src/schema/collector-client.ts` | Alcance normal del cobrador |
| Alcance por zona `zoneScopePredicate` (ltree `<@`) | `apps/api/src/iam/zone-scope.ts` | AuthZ del coordinador por subárbol |
| Almacenamiento cifrado MinIO (AES-256-GCM) | `apps/api/src/shared/minio-encrypted-storage.ts`, `payments/payment-receipt.storage.ts` | Fotos de comprobantes de gasto y consignación |
| Cron por tenant con `withPlatformTx` | `apps/api/src/collections/collection-reminder.cron.ts` | Cierre automático de período y alertas de rendición |
| Config por tenant en JSONB (`operational_settings`, …) + `timezone` | `packages/db/src/schema/tenant-config.ts` | `settlement_settings` y hora límite de rendición |
| Sync bancaria / `incoming_credit` (Inter, PicPay, Mercado Pago) | `apps/api/src/payments/incoming-credit.repository.ts`, `cash/banking` | Verificación de consignaciones |

### 2.2 Gaps que bloquean la liquidación (hay que cerrarlos primero)

| # | Gap | Evidencia | Consecuencia si no se cierra |
|---|---|---|---|
| G1 | **El cobro en efectivo no entra al libro** | `CashPaymentDrizzleRepository.register` (`apps/api/src/payments/cash-payment.repository.ts`) crea pago VERIFIED + abonos, pero **no postea** `cash_transaction` | El efectivo del cobrador no existe como dinero: no hay rendición posible |
| G2 | **El otorgamiento directo no debita caja** | `credit.repository.ts:26` inserta el crédito sin asiento `DISBURSEMENT` | Cajas infladas; la liquidación no cuadra |
| G3 | **Sin zona en el dinero** | `cash_box`, `cash_transaction` y `expense` no tienen `zone_id` (solo `credit.zone_id`) | No hay liquidación por zona |
| G4 | **Abono sin desglose capital/interés** | `installment` solo tiene `amount_due_minor`; `payment_allocation` solo `amount_minor` | No hay "interés ganado vs. capital recuperado" |
| G5 | **Gasto sin motivo de rechazo, zona ni comprobante** | `packages/db/src/schema/expense.ts` | No cumple el control de gastos acordado |
| G6 | **Consignación como doble ingreso** | La sync bancaria vería el depósito como un ingreso más (UNIDENTIFIED / PAYMENT_IN) | El mismo dinero entraría dos veces al libro |

**Pendiente heredado:** migraciones sin aplicar de trabajos previos (ver memorias de tesorería,
arqueo y visitas). Deben estar aplicadas antes de la Fase 1.

---

## 3. Modelo conceptual

### 3.1 Dos lecturas del mismo libro

- **Por caja — ¿dónde está la plata?** Saldo real por caja/cuenta. `cash_box.zone_id` dice a qué zona
  pertenece (NULL = caja del tenant, raíz). Una zona **puede usar** una caja si la zona de la caja es
  ella misma o un ancestro (`zona.path <@ caja_zona.path`, o caja sin zona).
- **Por zona — ¿quién generó el flujo?** Cada asiento **sella** `zone_id` al postearse, según su origen:

  | Asiento | Zona sellada |
  |---|---|
  | `PAYMENT_IN`, `DISBURSEMENT` | `credit.zone_id` |
  | `EXPENSE` | `expense.zone_id` |
  | Entrega/consignación/transferencia desde caja de ruta | zona del cobrador (zona de su caja de ruta) |
  | `TRANSFER`, `ADJUSTMENT`, `WITHDRAWAL`, `UNIDENTIFIED` | zona de la caja (o NULL = tenant) |

  Sellar al escribir garantiza que la foto no cambia si un crédito se reasigna de zona después.
  **Por zona se reporta flujo, no saldo** (las zonas comparten cajas); el saldo solo existe por caja.

### 3.2 La caja de ruta es la cuenta del cobrador

```
Caja de ruta del cobrador (efectivo en su poder)
  + cobros en ruta                 PAYMENT_IN   (al liquidar cada visita con pago)
  − gastos aprobados de su caja    EXPENSE      (si el coordinador elige su caja)
  − consignación verificada        TRANSFER     ruta → caja BANK (cuenta PIX)
  − entrega al coordinador         TRANSFER     ruta → caja de oficina de la zona
  − cierre de deuda (solo ADMIN)   DEBT_CLOSURE PAYROLL | WRITE_OFF
  ─────────────────────────────────
  = saldo al cerrar la rendición   → esperado 0; lo que quede es DEUDA y se arrastra solo
```

No hay tabla de deuda: **la deuda es el saldo de la caja de ruta después de la rendición.** Así no
existe un segundo número que pueda divergir del libro.

### 3.3 Capital e interés proporcional (sin error de redondeo)

Para un crédito con `principal` y `total = principal.applyInterest(pct)`:

```
capitalAcum(pagado) = ⌊ pagado × principal / total ⌋
capitalDelAbono     = capitalAcum(pagadoAntes + abono) − capitalAcum(pagadoAntes)
interesDelAbono     = abono − capitalDelAbono
```

Se calcula sobre lo **acumulado** y no abono por abono, así que al pagar el total
`Σ capital = principal` y `Σ interés = total − principal` **exactamente**. El desglose se **persiste** en
`payment_allocation` al aplicar el abono (la foto nunca recalcula).

---

## 4. Modelo de datos (cambios en esquema Drizzle)

> Todo cambio se hace en `packages/db/src/schema/*` y luego **`pnpm db:generate`** (nunca DDL a
> mano). Las tablas nuevas llevan `tenant_id` + RLS `FORCE`; las append-only revocan UPDATE/DELETE
> al rol `app` (la parte RLS/REVOKE sigue el patrón de snapshots encadenados, ver memoria
> *drizzle-rls-migration-snapshots*).

### 4.1 Cambios a tablas existentes

| Tabla | Cambio | Fase |
|---|---|---|
| `cash_box` | `zone_id uuid NULL` (NULL = caja del tenant) | 1 |
| `cash_transaction` | `zone_id uuid NULL` sellado al postear; `collector_id uuid NULL` (cobrador al que se atribuye) | 1 |
| `cash_transaction` | traza `field_order_id uuid NULL` | 4 |
| `cash_transaction` | `settles_period_id uuid NULL` (corrección de un período cerrado) | 6 |
| `cash_tx_kind` (enum) | + `DEBT_CLOSURE` (y columna `debt_closure_type`: `PAYROLL` / `WRITE_OFF`, obligatoria si kind = `DEBT_CLOSURE`, por CHECK) | 2 |
| `payment_allocation` | `principal_minor`, `interest_minor` (CHECK `principal + interest = amount`) | 1 |
| `expense` | `zone_id`, `rejection_reason`, `receipt_document_id`, `paid_from_cash_box_id` | 3 |
| `tenant_config` | JSONB `settlement_settings`: `{ frequency, anchorDay, autoClose, remittanceDeadline }` | 2 / 6 |

### 4.2 Tablas nuevas

| Tabla | Propósito | Naturaleza |
|---|---|---|
| `collector_remittance` | Rendición diaria: cobrador, fecha de negocio, esperado, declarado, recibido (conteo), faltante, estado, timestamps | Estado + eventos |
| `field_order` | Orden al cobrador: `kind` (`ROUTE_STOP` / `DEPOSIT`), cobrador, emitida por, zona, monto (consignación), estado, timestamps | Agregado |
| `field_order_event` | Bitácora de la orden: `ISSUED`, `SEEN`, `REPORTED`, `VERIFIED`, `DISPUTED`, `CANCELLED`, `COMMENT` + payload + actor | **Append-only** |
| `collection_route` | Ruta propuesta/despachada: zona, fecha, creada por, geometría OSRM | Agregado |
| `route_stop` | Parada: ruta, crédito, cobrador asignado, orden, `amount_to_collect_minor`, resultado (`PAID` / `NOT_PAID` / `PROMISE` / `NOT_FOUND`), motivo, fecha de promesa, `payment_id` | Estado (el resultado se registra una sola vez) |
| `settlement_period` | Foto del período: rango, `retroactive`, cerrado por (usuario o `SYSTEM`), totales tesorería y cartera | **Append-only** |
| `settlement_line` | Detalle de la foto por **zona**, por **caja** y por **cobrador** (concepto × dimensión × monto) | **Append-only** |

Índices de idempotencia: una rendición por `(tenant, collector, business_date)`; un período por
`(tenant, period_start)`; un resultado por `route_stop`; un asiento por `field_order_id` de
consignación verificada.

---

## 5. Máquinas de estado

### 5.1 Parada de ruta (`route_stop`) y orden de ruta

```
PROPOSED ──despachar──► ASSIGNED ──cobrador la abre──► SEEN ──liquida visita──► RESOLVED
    │                       │                                                     │
    └── quitar ─────────────┴──── cancelar (coordinador, con motivo) ──► CANCELLED│
                                                                                  ▼
                                    (el efectivo cobrado entra a la rendición del día)
```

- Mientras está en `ASSIGNED` o `SEEN` (y es de un cliente no asignado) el cobrador tiene la
  **vista mínima**; en `RESOLVED` o `CANCELLED` la pierde.
- Resultado `PAID` ⇒ registra el abono en efectivo (G1) → `PAYMENT_IN` a la caja de ruta, en la misma tx.

### 5.2 Orden de consignación (`field_order` DEPOSIT)

```
ISSUED ─► SEEN ─► REPORTED (comprobante + cuenta + fecha/hora + monto) ─► VERIFIED
                        │                                                    │
                        └──────────── DISPUTED ◄── coordinador objeta ◄─────┘ (antes de verificar)
                                         └─► REPORTED (el cobrador corrige; queda todo en la bitácora)
```

- `VERIFIED` ⇒ `TRANSFER` caja de ruta → caja BANK por el monto verificado, **enlazado** al movimiento
  bancario (`incoming_credit`) para que la sync **no lo cuente como abono** (G6).
- Verificación asistida: el sistema sugiere el movimiento bancario por monto y ventana de tiempo;
  el coordinador confirma.

### 5.3 Rendición diaria (`collector_remittance`)

```
OPEN (hay ruta o efectivo del día) ─► SUBMITTED (cobrador declara entrega) ─► RECEIVED (coordinador cuenta)
     │                                                                            │
     └── pasada la hora límite sin SUBMITTED ⇒ marcada ATRASADA (no es estado, es cálculo)
                                                                    faltante > 0 ⇒ queda como saldo = deuda
```

- **Esperado** (sistema): saldo inicial de la caja de ruta + cobros − gastos de su caja − consignado verificado.
- **Recibido**: conteo del coordinador → `TRANSFER` ruta → caja de oficina por lo contado.
- **Faltante** = esperado − recibido; no se registra aparte: es el saldo que queda en la caja de ruta.

### 5.4 Solicitud de gasto (v2)

```
PENDING ──aprobar (caja pagadora obligatoria)──► APPROVED  ⇒ EXPENSE OUT de la caja elegida
   └────rechazar (motivo obligatorio)──────────► REJECTED  ⇒ sin efecto de caja
```

### 5.5 Período de liquidación

```
(abierto = vista en vivo, no se persiste) ──corte (cron si autoClose, o ADMIN)──► CLOSED (foto sellada)
```

---

## 6. Invariantes (cada uno con prueba)

| # | Invariante | Capa de la prueba |
|---|---|---|
| I1 | `saldo_inicial + Σ IN − Σ OUT = saldo_final` por caja y total del período | Dominio |
| I2 | `saldo_inicial(n) = saldo_final(n−1)`: los períodos encadenan sin huecos ni solapes | Dominio + integración |
| I3 | Σ líneas por zona = Σ líneas por caja = total del período | Dominio |
| I4 | El saldo final de la foto = el saldo del libro al instante del corte | Integración |
| I5 | Capital/interés: `capital + interés = abono`; al pagar el total, `Σ capital = principal` exacto | Dominio (incluye redondeo y abonos de 1 unidad) |
| I6 | Un cobro en efectivo → exactamente un `PAYMENT_IN` en la caja de ruta del cobrador (idempotente) | Integración |
| I7 | Una consignación verificada → un solo `TRANSFER`, y su movimiento bancario **no** se registra como abono | Integración |
| I8 | Rendición: `esperado = recibido + faltante`; el faltante coincide con el saldo de la caja de ruta tras el conteo | Dominio + integración |
| I9 | `saldo ≥ 0` en toda caja (el faltante es saldo positivo de la caja de ruta, nunca negativo) | Dominio (`assertCanPost`) |
| I10 | Un período se cierra una sola vez; un cierre retroactivo nunca solapa un período ya cerrado | Integración |
| I11 | La vista mínima de parada no expone saldo, historial ni otras paradas (prueba de contrato de salida) | API |
| I12 | `DEBT_CLOSURE` solo ADMIN, con motivo; `WRITE_OFF` resta de la utilidad y `PAYROLL` no | Dominio + API |

---

## 7. Fases

Cada fase arranca por **spec Gherkin → prueba de dominio → implementación**, pasa **typecheck + lint
+ test + build**, y termina con `pnpm db:generate` pedido al usuario si tocó esquema.

### Fase 1 — Cimientos del libro (G1–G4) ✅

- **G1:** `CashPaymentDrizzleRepository.register` postea `PAYMENT_IN` a la caja de ruta del cobrador
  autenticado (o falla con `DomainError` si no tiene caja de ruta activa), en la misma tx,
  idempotente por `payment_id`.
- **G2:** otorgamiento directo exige `fundingCashBoxId` y usa `postCashOut` (igual que la aprobación).
- **G3:** `zone_id` en `cash_box` y `cash_transaction`; regla pura `stampZone(origen)`; todos los
  posters sellan zona (y `collector_id` cuando aplica). Selector de zona en el alta de cajas; regla
  "la zona puede usar cajas de sus ancestros" en los selectores de caja.
- **G4:** regla pura `splitAllocation` (§3.3) en `packages/domain/src/credit/payment`; `allocatePayment`
  devuelve el desglose; se persiste en `payment_allocation`.
- **Aceptación:** I5, I6, I9; cobro en efectivo visible en la caja de ruta; desembolso directo baja la caja.
- **Alcance de esquema real de la Fase 1:** solo `cash_box.zone_id`, `cash_transaction.zone_id` +
  `collector_id` y `payment_allocation.principal_minor` + `interest_minor`. Las trazas
  `field_order_id` / `settles_period_id` llegan con las fases que las usan (4 y 6).
- **Riesgo cubierto:** la cola offline del móvil **descarta** los errores de negocio (4xx). Por eso
  el cobro en efectivo se bloquea en la pantalla (antes de encolar) si el cobrador no tiene caja
  de ruta activa (`GET /me/cash-box`).

```gherkin
Escenario: El cobro en efectivo entra a la caja de ruta del cobrador
  Dado un cobrador con caja de ruta activa con saldo 0
  Y un crédito de la zona "Norte" con cuotas pendientes
  Cuando el cobrador registra un abono en efectivo de 50.000
  Entonces la caja de ruta tiene saldo 50.000
  Y hay un único asiento PAYMENT_IN con zona "Norte" y cobrador = el que cobró
  Y reintentar con la misma Idempotency-Key no crea otro asiento

Escenario: Sin caja de ruta no se recibe efectivo
  Dado un usuario sin caja de efectivo asignada
  Cuando intenta registrar un abono en efectivo
  Entonces responde 409 NO_ROUTE_CASH_BOX
  Y no se crea pago, abono ni asiento

Escenario: El otorgamiento directo debita la caja de origen
  Dado una caja de oficina de la zona "Norte" con saldo 1.000.000
  Cuando un coordinador otorga un crédito de 300.000 en "Norte" desde esa caja
  Entonces el crédito nace ACTIVE
  Y la caja queda con saldo 700.000 por un asiento DISBURSEMENT con zona "Norte"

Escenario: Sin saldo no hay crédito
  Dado una caja con saldo 100.000
  Cuando se otorga un crédito de 300.000 desde esa caja
  Entonces responde 400 y no existe el crédito ni su cronograma

Escenario: Una zona hija usa la caja del padre; una zona hermana no
  Dado la caja "Oficina Norte" de la zona "norte"
  Cuando se desembolsa un crédito de la zona "norte.centro" desde esa caja
  Entonces se permite
  Pero desde un crédito de la zona "sur" responde 409 BOX_NOT_USABLE_BY_ZONE

Escenario: Cada abono se desglosa en capital e interés proporcional
  Dado un crédito de capital 1.000 con total a pagar 1.200 (20%)
  Cuando se abonan 600
  Entonces el abono registra capital 500 e interés 100
  Y al completar el pago Σ capital = 1.000 y Σ interés = 200 exactamente
```

### Fase 2 — Rendición diaria y deuda del cobrador ✅

- `tenant_config.settlement_settings.remittanceDeadline` (hora local) con edición en Ajustes.
- Dominio: `computeRemittance(movimientosDelDía)` → esperado; `isRemittanceRequired(día)` (tuvo
  orden de ruta **o** movió efectivo); `remittanceLag(deadline, now, tz)`.
- API: `GET /me/remittance/today` (cobrador), `POST /me/remittance/submit`,
  `POST /remittances/:id/receive` (coordinador, con conteo), `GET /remittances?status=pending|late`
  (coordinador por subárbol).
- `DEBT_CLOSURE` (`PAYROLL` / `WRITE_OFF`) solo ADMIN con motivo; `GET /collectors/debts` = reporte
  para nómina.
- Móvil: perfil del cobrador con **efectivo en poder, rendición del día e historial**; panel del
  coordinador con **quién no ha rendido y cuánto atraso lleva** (fecha y hora).
- Cron (mismo patrón que cobranza): marca atrasos y avisa al coordinador.
- **Aceptación:** I8, I12; un cobrador sin ruta ni efectivo no aparece como atrasado.
- **Decisiones de implementación:**
  - La hora límite vive en `operational_settings.remittanceDeadlineHourLocal` (0–23, default 20),
    junto al resto de ajustes de cobro (sin columna nueva). La zona horaria es la del tenant
    (`collection_reminder_settings.timezone`).
  - **Rendición = corte.** Cubre los movimientos de la caja de ruta desde el corte anterior. El
    cobrador **declara** (`SUBMITTED`); el coordinador **cuenta y recibe** (`RECEIVED`): `TRANSFER`
    ruta → caja de oficina por lo contado, en la misma tx. Lo no entregado queda como saldo = deuda.
  - **Obligación de rendir** = cobró efectivo (`PAYMENT_IN`) después del último corte (la orden de
    ruta se suma en la Fase 5). Atraso desde la hora límite del día del cobro más antiguo sin rendir.
  - **Deuda arrastrada** = saldo de la caja al último corte − cierres de deuda posteriores.
  - **Orden total por caja:** todo asiento a una caja de ruta se inserta bajo su advisory lock, y
    `cash_transaction.created_at` usa `clock_timestamp()` (reloj al insertar, no inicio de tx). Así
    "posterior al corte" coincide con el orden de los candados y ningún cobro concurrente se pierde.
  - El cron de avisos al coordinador queda para cuando exista un canal de notificación al personal;
    el atraso se calcula al leer (no requiere job).

```gherkin
Escenario: El cobrador rinde cuentas al volver de ruta
  Dado un cobrador que hoy cobró 300.000 en efectivo y tiene una deuda anterior de 20.000
  Cuando abre "Mi caja"
  Entonces ve: saldo anterior 20.000, cobrado 300.000, esperado a entregar 320.000
  Cuando declara que entrega 320.000
  Entonces su rendición queda "por recibir" y deja de contar atraso

Escenario: El coordinador recibe y el faltante queda como deuda
  Dado una rendición declarada con esperado 320.000
  Cuando el coordinador cuenta 300.000 y los recibe en la caja de oficina de la zona
  Entonces la caja de oficina sube 300.000 y la caja de ruta queda con 20.000
  Y la deuda arrastrada del cobrador es 20.000

Escenario: No se recibe más de lo esperado
  Cuando el coordinador cuenta más de lo que dice el libro
  Entonces responde 409 COUNT_EXCEEDS_EXPECTED (primero hay que registrar el cobro que falta)

Escenario: Atraso en la rendición
  Dado la hora límite 20:00 y un cobro en efectivo hoy a las 10:00
  Cuando son las 22:30 y el cobrador no ha declarado
  Entonces aparece "atrasado" con 2 h 30 min de atraso desde hoy 20:00

Escenario: Sin cobros en efectivo no hay obligación
  Dado un cobrador sin cobros en efectivo desde su último corte
  Entonces aparece "al día" aunque arrastre deuda

Escenario: Cierre de deuda solo por el ADMIN
  Dado un cobrador con deuda arrastrada de 20.000
  Cuando el ADMIN la cierra como "descuento de nómina" con motivo
  Entonces la deuda queda en 0 con un asiento DEBT_CLOSURE PAYROLL
  Y un COORDINATOR recibe 403 al intentarlo
  Y cerrar más de la deuda arrastrada responde 409 DEBT_EXCEEDED
```

### Fase 3 — Solicitudes de gasto v2 ✅

- Esquema: `zone_id`, `rejection_reason`, `receipt_document_id`, `paid_from_cash_box_id`.
- Contrato: la solicitud exige comprobante (subida cifrada a MinIO); rechazar exige motivo; aprobar
  exige caja pagadora (ya existe) restringida a las cajas usables por la zona.
- Móvil: el cobrador abre la solicitud desde su perfil y ve su historial con estados, motivos y
  fechas; el coordinador ve la bandeja por subárbol.
- **Aceptación:** sin foto no hay solicitud; rechazo sin motivo → 400; aprobación → `EXPENSE` OUT sellado con zona.
- **Decisiones de implementación:**
  - Foto con `expo-image-picker` (autorizado; cámara o galería) y subida `multipart/form-data`
    (`FileInterceptor` de NestJS, sin dependencias nuevas en la API). Cifrada en MinIO (AES-256-GCM)
    como los comprobantes de pago; se sirve descifrada con `no-store`. JPEG/PNG/WEBP/HEIC/PDF, ≤ 8 MB.
  - **Zona del gasto** = zona de la caja de ruta de quien lo pide (NULL si no tiene: solo el ADMIN
    lo revisa). **Alcance:** el cobrador ve solo los suyos; el coordinador, los de su subárbol.
    *(Corrige un hueco previo: `GET /expenses` listaba todo el tenant a cualquier rol.)*
  - **Caja pagadora:** caja de oficina o banco que la zona puede usar, o la **caja de ruta de quien
    pidió** (se descuenta de su efectivo y entra en su rendición). Nunca la de otro cobrador.
  - El asiento `EXPENSE` sella la zona del gasto y `collector_id` = quien lo pidió.

```gherkin
Escenario: El cobrador pide un gasto con foto
  Dado un cobrador con caja de ruta en la zona "Norte"
  Cuando pide un gasto de 15.000 "Gasolina" adjuntando la foto del recibo
  Entonces queda PENDIENTE en la zona "Norte" y aparece en su historial

Escenario: Sin foto no hay solicitud
  Cuando pide un gasto sin adjuntar foto
  Entonces responde 400 y no se crea nada

Escenario: El coordinador rechaza con motivo
  Cuando rechaza el gasto sin motivo
  Entonces responde 400
  Cuando lo rechaza con motivo "Sin soporte válido"
  Entonces queda RECHAZADO con motivo, fecha y hora, y el cobrador lo ve en su historial

Escenario: Aprobado desde la caja de ruta del cobrador
  Cuando el coordinador lo aprueba pagándolo desde la caja de ruta del propio cobrador
  Entonces sale un asiento EXPENSE de esa caja con zona "Norte" y cobrador = quien lo pidió
  Y su rendición lo muestra como "Gastos pagados"

Escenario: No se paga desde la caja de otro cobrador
  Cuando se intenta aprobar pagándolo desde la caja de ruta de otro cobrador
  Entonces responde 409 EXPENSE_BOX_NOT_ALLOWED

Escenario: Alcance
  Dado un gasto de la zona "Sur"
  Entonces un cobrador que no lo pidió no lo ve
  Y un coordinador de "Norte" no lo ve ni lo puede revisar (404)
```

### Fase 4 — Órdenes de consignación ✅

- `field_order` + `field_order_event` (append-only) con la máquina de §5.2.
- El coordinador ve el **efectivo en la calle por cobrador** y emite la orden (monto ≤ saldo de la
  caja de ruta).
- El cobrador reporta con comprobante obligatorio, cuenta destino, fecha/hora y monto.
- Verificación: sugerencia de match con `incoming_credit`; al verificar, `TRANSFER` ruta → BANK y el
  movimiento bancario queda **consumido** por la orden (excluido del ruteo de pagos, G6).
- Comentarios y objeciones en la bitácora; historial para ambos lados.
- **Aceptación:** I7; una orden disputada conserva todo su historial.
- **Decisiones de implementación:**
  - `field_order` (kind `DEPOSIT`; la Fase 5 agrega su propio `route_stop`) + `field_order_event`
    **append-only** (RLS + `REVOKE UPDATE, DELETE`): `ISSUED`, `SEEN`, `REPORTED`, `DISPUTED`,
    `VERIFIED`, `CANCELLED`, `COMMENT`, con actor, fecha/hora y mensaje.
  - La orden fija la **cuenta destino** (caja BANK que la zona del cobrador puede usar); el cobrador
    reporta monto, fecha/hora, referencia y **foto obligatoria**.
  - **Anti doble ingreso (G6):** `incoming_credit.consumed_by_field_order_id` (CHECK: nunca
    consumido por pago y por orden a la vez). Los 4 puntos que buscan créditos "libres" para
    conciliar pagos exigen ahora que tampoco los haya consumido una orden.
  - La trazabilidad al libro es `field_order.transfer_group_id` (el `TRANSFER` ruta → banco); no hace
    falta `cash_transaction.field_order_id`.
  - Comprobantes: base común cifrada (`EncryptedFileBucket`) reutilizada por gastos y consignaciones.

```gherkin
Escenario: El coordinador ordena consignar el efectivo acumulado
  Dado un cobrador de "Norte" con 300.000 en su caja de ruta
  Cuando el coordinador ordena consignar 250.000 a la cuenta PIX "Inter Norte"
  Entonces al cobrador le aparece la orden con fecha y hora de solicitud
  Y ordenar más que el efectivo en su poder responde 409 DEPOSIT_EXCEEDS_CASH

Escenario: El cobrador reporta con comprobante
  Cuando el cobrador abre la orden
  Entonces queda "vista" en la bitácora
  Cuando reporta 250.000 depositados hoy 15:20 con foto del comprobante
  Entonces queda REPORTADA; sin foto responde 400

Escenario: Verificación contra el banco sin doble ingreso
  Dado un ingreso de 250.000 en la cuenta "Inter Norte" traído por la sincronización bancaria
  Cuando el coordinador verifica la orden enlazando ese ingreso
  Entonces la caja de ruta baja 250.000 y la cuenta "Inter Norte" sube 250.000 (TRANSFER)
  Y ese ingreso queda consumido por la orden: la conciliación de pagos ya no lo ofrece
  Y enlazar un ingreso de otra cuenta, de otro monto o ya consumido responde 409

Escenario: Objeción y aclaración
  Cuando el coordinador objeta con "El comprobante no es legible"
  Entonces la orden queda OBJETADA y el cobrador puede reportar de nuevo
  Y todo el hilo (reportes, objeción, comentarios) queda en la bitácora

Escenario: Alcance
  Entonces el cobrador solo ve sus órdenes y un coordinador de otra zona no las ve (404)
```

### Fase 5 — Órdenes de ruta ✅

- `collection_route` + `route_stop`. Propuesta = clientes que "necesitan visita" (regla existente) de
  la zona + optimización OSRM.
- El coordinador **reparte paradas** entre cobradores y despacha con un botón (evento `ISSUED` por
  cobrador, con fecha y hora).
- Vista mínima de parada (endpoint propio, contrato de salida cerrado: nombre, dirección, lat/lng,
  teléfono, monto a cobrar).
- Liquidar visita: `PAID` (monto → cobro en efectivo de la Fase 1) / `NOT_PAID` + motivo / `PROMISE` +
  fecha / `NOT_FOUND`; reutiliza `collection_note` / `collection_visit`.
- Perfil del cobrador: rutas pendientes con **"solicitada el dd/mm hh:mm"** y antigüedad; histórico.
- **Aceptación:** I11; el recaudo de cada parada se atribuye al cobrador que la liquidó.
- **Decisiones de implementación:**
  - Rutas bajo `/collection-routes` (`/routes` ya es la "lista de cobros" del legado).
  - **Dirección del cliente:** no existía en el modelo (solo lat/lng). Se agrega `borrower.address`
    (opcional, editable en la ficha del cliente) y la parada guarda una **copia** al despachar
    (dirección, teléfono, nombre, coordenadas, monto a cobrar): la vista mínima no consulta el
    crédito ni al cliente, así no puede filtrar saldo ni historial.
  - **Monto a cobrar** = saldo vencido al despachar (Σ cuotas vencidas − abonado), regla pura.
  - Una sola parada abierta por crédito (índice único parcial): no se despacha dos veces el mismo
    cliente. La vista mínima solo existe mientras la parada está abierta (`ASSIGNED`/`SEEN`).
  - **Liquidar la parada** es una transacción: `PAID` registra el cobro en efectivo (asiento a la
    caja de ruta de quien cobró → entra en su rendición); `PAID`/`NOT_PAID`/`PROMISE` registran la
    visita (reagenda por ciclo de mora); `NOT_FOUND` deja solo la observación (sigue pendiente).
  - La obligación de **rendir dinero** sigue siendo "cobró efectivo"; la ruta se rinde parada por
    parada (su resultado es el informe de visita). Un día de ruta sin cobros no exige rendición de caja.

```gherkin
Escenario: El sistema propone y el coordinador reparte
  Dado 3 clientes de la zona "Norte" que necesitan visita (mora ≥ umbral)
  Cuando el coordinador pide la propuesta de ruta de "Norte"
  Entonces recibe las 3 paradas ordenadas por recorrido, con el monto vencido de cada una
  Cuando asigna 2 paradas a "Ana" y 1 a "Beto" y despacha
  Entonces a cada cobrador le aparecen sus paradas con "solicitada el dd/mm hh:mm"
  Y despachar de nuevo un cliente con parada abierta responde 409 STOP_ALREADY_OPEN

Escenario: Vista mínima de un cliente que no es de su cartera
  Dado que "Ana" recibe una parada de un cliente que no tiene asignado
  Entonces ve nombre, dirección, mapa, teléfono y monto a cobrar
  Pero no ve saldo total, historial ni las paradas de "Beto"
  Y al liquidar la parada, deja de verla en sus pendientes

Escenario: Liquidar visita con cobro
  Cuando "Ana" liquida la parada como PAGÓ 50.000
  Entonces se registra el abono, entra a la caja de ruta de "Ana" y queda la visita
  Y PAGÓ sin monto, NO PAGÓ sin motivo o PROMESA sin fecha (o con fecha pasada) responden 400

Escenario: No encontrado
  Cuando la liquida como NO ENCONTRADO
  Entonces queda la observación pero el cliente sigue pendiente de visita
```

### Fase 6 — Liquidación por período ✅

- Dominio: `periodBoundaries(settings, fecha, tz) → [inicio, fin)` (casos borde: febrero, fin de año,
  cambio de configuración a mitad de período → el cambio aplica desde el siguiente corte);
  `buildSettlement(asientos, cartera)` → totales + líneas.
- Cron por tenant: cierra al pasar el corte si `autoClose`; idempotente por `(tenant, period_start)`.
- Endpoints: `GET /settlements/current` (período abierto en vivo), `GET /settlements` (paginado),
  `GET /settlements/:id`, `GET /settlements/:id/movements` (paginado y filtrable),
  `POST /settlements/close` (ADMIN), `POST /settlements/retroactive` (ADMIN, períodos pasados).
  Todos con `requireTenant` + `requireRole`; COORDINATOR recortado por `zoneScopePredicate`.
- Contenido de la foto:
  - **Tesorería:** saldo inicial, cobrado, desembolsado, gastos, consignado, entregado, ajustes,
    cierres de deuda, saldo final; por caja y por zona.
  - **Cartera / resultado:** créditos nuevos (cantidad y monto), capital recuperado, **interés
    ganado**, gastos, condonaciones, **utilidad = interés − gastos − condonado**, recaudo esperado vs.
    real (%), mora al corte.
  - **Por cobrador:** recaudo, gastos, consignado, entregado, deuda arrastrada, rendiciones atrasadas.
- **Aceptación:** I1–I4, I10.
- **Decisiones de implementación:**
  - Configuración en `operational_settings` (junto a la hora de rendición, sin columna nueva):
    `settlementFrequency` (`WEEKLY` | `BIWEEKLY` | `MONTHLY`), `settlementAnchorDay` (día de INICIO:
    1–7 lunes a domingo en semanal; 1–28 en mensual; la quincena es fija 1–15 / 16–fin) y
    `settlementAutoClose`.
  - **Períodos contiguos por construcción:** cada cierre sella el período SIGUIENTE al último cerrado
    (empieza donde terminó el anterior), así que no hay huecos ni solapes (I2, I10). Si nunca se ha
    cerrado ninguno, el primero es el que contiene el primer asiento del libro: cerrar en orden
    reconstruye la historia (retroactivos). Un cambio de configuración aplica desde el siguiente
    corte (el período en curso termina donde diga la nueva regla, sin solapar el último cerrado).
  - Un único `POST /settlements/close` (ADMIN) cierra el siguiente período terminado; repetirlo
    rellena la historia. **Retroactivo** = cerrado después de su día de corte.
  - Foto en `settlement_period.snapshot` (JSONB append-only, `REVOKE UPDATE, DELETE`): se guarda con
    la ruta de zona en cada línea para que el coordinador la vea recortada a su subárbol sin tocar
    la BD. La mora al corte refleja el estado de la cartera al momento del cierre.
  - No hace falta `cash_transaction.settles_period_id`: el libro es append-only y fechado con
    `clock_timestamp()`, así que una corrección posterior cae sola en el período siguiente.

```gherkin
Escenario: Período semanal en curso
  Dado la liquidación semanal que empieza el lunes, y hoy es jueves
  Cuando el socio abre la liquidación actual
  Entonces ve desde el lunes hasta hoy: saldo inicial, lo que entró, lo que salió y el saldo por caja
  Y el resultado: interés ganado, capital recuperado, gastos, condonaciones y utilidad

Escenario: Cierre automático al corte
  Dado el cierre automático activo
  Cuando pasa la medianoche del domingo en la zona horaria del tenant
  Entonces el cron sella la semana como una foto que ya no cambia
  Y el saldo inicial de la semana siguiente es el saldo final de esta

Escenario: Cuadre
  Entonces por cada caja: saldo inicial + entradas − salidas = saldo final
  Y la suma por zonas = la suma por cajas = el total

Escenario: Historia retroactiva
  Dado un libro con movimientos desde hace 5 semanas y ningún período cerrado
  Cuando el ADMIN cierra repetidamente
  Entonces se sellan las 5 semanas en orden, marcadas como retroactivas, y la actual no se puede cerrar

Escenario: Alcance del coordinador
  Entonces el coordinador de "Norte" ve solo las zonas, cajas y cobradores de su subárbol
  Y el cobrador no ve liquidaciones (403)
```

### Fase 7 — Pantallas de dirección y estadísticas ✅

- **Período actual:** filas = conceptos, columnas = cajas o zonas (conmutables); tarjetas de
  utilidad y % de recaudo.
- **Detalle de movimientos:** tabla paginada con filtros (tipo, caja, zona, cobrador) y exportación CSV.
- **Histórico:** columnas = últimos N períodos cerrados, filas = indicadores; gráfica de tendencia
  (recaudo, prestado, utilidad); abrir cualquier foto anterior.
- **Tablero del cobrador (coordinador/admin):** tiempos de respuesta a órdenes, % de visitas
  efectivas, faltantes, atrasos de rendición.

---

- **Implementado:** segmento **Liquidación** en Dinero (en curso + histórico). Tarjetas de
  resultado; tabla de tesorería por concepto con columnas conmutables cajas/zonas (+ total); tabla de
  cobradores con su desempeño del período (paradas liquidadas/despachadas, % de visitas con pago,
  tiempo promedio de visita, consignaciones verificadas y tiempo hasta reportar, rendiciones y
  cuántas tarde — guardado en la foto para la estadística histórica); movimientos exactos del período
  (`before` exclusivo) con filtros tipo/caja/zona y **CSV** (`GET /cash/transactions/export`, celdas
  neutralizadas contra inyección de fórmulas). Histórico: gráfica de tendencia (cobrado, prestado,
  utilidad; paleta validada con la skill dataviz en claro y oscuro; renderizada y revisada) y tabla
  comparativa de los últimos 12 períodos; tocar un período abre su fotografía.
- De paso: el libro (`/cash/transactions`) ahora recorta al coordinador a su subárbol de zonas.

## 8. Seguridad, auditoría y operación (checklist transversal)

- **AuthZ en cada endpoint:** `requireTenant` + `requireRole`. COORDINATOR acotado por subárbol;
  COLLECTOR solo `/me/*` y paradas asignadas. El cobrador nunca recibe cifras de cartera ni de liquidación.
- **Audit log:** toda orden emitida/verificada, rendición recibida, gasto decidido, cierre de deuda y
  cierre de período van a `audit_log`, además de la bitácora propia de cada orden.
- **Idempotencia:** `Idempotency-Key` en cobros, reportes de orden, recepción de rendición y cierre.
- **PII:** los comprobantes se guardan cifrados en MinIO; los logs llevan `tenantId` + `correlationId`
  y nunca montos junto a nombres/teléfonos.
- **Paginación** en todos los listados; la foto del período evita recalcular (read model).

---

## 9. ADR propuesto (#41)

> **Liquidación = fotografía sellada del libro de cajas + caja de ruta como cuenta del cobrador.**
> La liquidación por período no calcula saldos: agrega `cash_transaction` en `[inicio, fin)` y guarda
> la foto append-only (`settlement_period` / `settlement_line`). Cada asiento sella `zone_id` y
> `collector_id` al postearse (atribución por origen, estable ante reasignaciones). La deuda del
> cobrador es el saldo de su caja de ruta tras la rendición, sin tabla paralela; se cierra solo por
> `DEBT_CLOSURE` (`PAYROLL` / `WRITE_OFF`). **Descartado:** reintroducir un escalar de caja paralelo
> (la causa del retiro en julio); tabla de deuda separada (segundo número que puede divergir);
> atribución por caja (las zonas hijas comparten cajas del padre).

Al implementar la Fase 1 se registra el ADR en [ARCHITECTURE.md](ARCHITECTURE.md) y se actualiza
[DESIGN.md](DESIGN.md) (bounded context de tesorería y de cobranza de campo).

---

## 10. Riesgos y temas abiertos

- **Cobros en efectivo sin caja de ruta:** hoy cualquier rol de datos puede registrar efectivo. Decisión
  de implementación: exigir caja de ruta activa al cobrador (fallo rápido) y definir, en la Fase 1, qué
  hace un coordinador que cobra en efectivo (su propia caja de oficina).
- **Consignaciones en bancos sin sync:** la verificación queda manual con comprobante; el match
  automático solo aplica donde exista `incoming_credit`.
- **Cambio de periodicidad:** aplica desde el siguiente corte; nunca re-corta períodos cerrados.
- **Nómina:** fuera del sistema; el sistema solo entrega el reporte de deudas y registra el cierre.
