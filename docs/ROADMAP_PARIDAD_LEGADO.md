# PreztiaOS — Roadmap de paridad con el sistema legado (concuo)

> **Estado:** documento vivo. Plan para alcanzar **paridad funcional** con el sistema legado de
> préstamos/cobranza gota a gota (capturas), respetando la arquitectura actual.
> **Creado:** 2026-06-14.
> **Relación:** *cómo* en [ARCHITECTURE.md](ARCHITECTURE.md); *qué* (funcional) en [DESIGN.md](DESIGN.md);
> cliente en [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md). Este archivo es el **plan de ejecución**.

---

## 0. Reglas vinculantes (gobiernan cada slice)

1. **Orden por slice:** spec Gherkin → prueba de dominio puro → contrato (ts-rest+zod) → caso de uso
   (`*Handler` + puerto) → repositorio Drizzle → controller NestJS → slice de cliente Expo.
2. **Multitenancy:** toda tabla nueva lleva `tenant_id` + bloque RLS `ENABLE/FORCE/POLICY`; toda
   escritura por `withTenantTx`. Migraciones con `pnpm db:generate` (nunca DDL a mano); snapshot
   encadenado con `id` único para no colisionar.
3. **Dinero** en `*_minor` (entero); fechas de negocio `date`, auditoría `timestamptz`; UUID v4.
4. **Maker-checker y movimientos de dinero** → bitácora `*_event` / `audit_log` append-only +
   idempotencia (`Idempotency-Key`).
5. **Listados** paginados (reusar `paginationQuery`), sin N+1; alcance por rol + subárbol de zonas
   (`zone-scope`) y cartera (`collector_client`).
6. **Cero dependencias nuevas** sin autorización explícita. Cambios **quirúrgicos** sobre lo existente.
7. **Dependencias hacia abajo:** dominio puro sin I/O; aplicación define puertos; infra implementa.

## 1. Decisiones de diseño tomadas

- **Entrega full-stack por slice** (dominio → contrato → API → pantalla Expo).
- **"Lista de cobros" (rutas) se modela reusando Zoning + `collector_client`** (una ruta = zona(s) +
  cobrador asignado sobre el `ltree`/IAM existentes); solo se añade el dato "última liquidada".
- **Se arranca por la Fase 1 (entidad `borrower`)**, que hoy no existe y es el cimiento del resto.

## 2. Hallazgo cardinal

**No existe entidad/tabla `borrower` (Cliente).** Hoy `borrowerId` es un `uuid` suelto referenciado
desde `credit`, `borrower_contact` y `collector_client`. El sistema legado gira en torno a "Clientes"
con datos ricos (cédula, nombre, apellido, negocio, teléfono, geo, color, cupo, bloqueo). Crear esa
entidad y migrar las referencias **sin romper datos existentes** es la Fase 1 y el punto más delicado.

## 3. Mapa: pantalla legada → contexto

| Pantalla legada | Contexto | Estado |
|---|---|---|
| Listado/Cupo Clientes, Resumen, color, bloqueo, notas | **Borrowers** (NUEVO) | ❌ |
| Listado Cuentas, detalle préstamo, cuotas con color, ver abonos, días atraso, deuda | **Credit & Portfolio** (EXTENDER) | ⚠️ base ✅ |
| Nueva/Lista Liquidada, Caja, Reporte diario | **Cash/Liquidación** (NUEVO) | ❌ |
| Solicitud Gastos (aprobación) | **Cash** (maker-checker) | ❌ |
| Solicitud Modificar Cliente (aprobación) | **Borrowers/Approvals** (NUEVO) | ❌ |
| Lista de cobros (rutas) | **Zoning/Routes** (EXTENDER, reuso) | ⚠️ |
| Posición clientes, último registro, recorrido GPS | **Geo/Tracking** (NUEVO) | ❌ |
| Listas personalizadas, Filtros clientes | **Borrowers/Segmentation** (NUEVO) | ❌ |
| Config (recargos, comisión, cupo, colores, flags) | **Tenant config** (EXTENDER) | ⚠️ |
| Reportería / mapas / export | **Reporting** (NUEVO, CQRS) | ❌ |

## 4. Adiciones al modelo de datos (Drizzle, con RLS `FORCE`)

- **`borrower`** — `national_id` (cédula), `first_name`, `last_name`, `business`, `phone`, `lat`,
  `lng`, `color` (enum), `credit_blocked`, `credit_limit_minor` (cupo), `created_at`.
- **`borrower_note`** — notas append-only por cliente.
- **`borrower_list` / `borrower_list_member`** — listas personalizadas.
- **`expense`** — gasto del cobrador (maker-checker): descripción, `amount_minor`, `status`.
- **`change_request`** — solicitud de modificación de cliente (payload + estado + revisor).
- **`settlement`** (liquidada) — `caja_anterior_minor`, `total_cobrado_minor`, `total_prestado_minor`,
  `gastos_minor`, `caja_actual_minor`, `route`/`collector`, `closed_at` (encadenada).
- **`collector_location`** — tracking GPS append-only (recorrido / último registro).
- **`audit_log`** transversal (resuelve deuda §21) para maker-checker.
- **Extender `tenant_config`** con `operational_settings` (jsonb validado): recargos, comisión %,
  cupo por defecto, paleta de colores, color por atraso, bloquear fechas atrasadas, etc.
- **Reporting:** read-models para Reporte diario, Listado de Cuentas y mapas.

## 5. Adiciones a contratos (`@preztiaos/contracts`)

`borrowers.ts`, `borrower-lists.ts`, `expenses.ts`, `change-requests.ts`, `settlements.ts`,
`routes.ts`, `daily-report.ts`, `tracking.ts`, extensión de `credit.ts` (detalle de cuenta +
cronograma + abonos) y `tenant-config.ts`. Todos reusan `paginationQuery` y header `x-tenant-id`.

## 6. Fases (cada fase = slices verticales completos)

1. **Borrowers (cimiento):** ✅ HECHA — entidad, CRUD, listado+filtros, cupo, bloqueo, color,
   notas, "clientes sin créditos". Migración 0020 (`borrower.id = credit.borrower_id` + backfill).
2. **Cartera y cuentas:** ✅ HECHA (núcleo) — Listado de Cuentas (deuda, días de atraso, cts
   pagas), detalle de préstamo (cabecera + valor cuota + abonos), cronograma con colores, "ver
   abonos" (reusa `getCreditPortfolio`/`PaymentsList`), **cupo/bloqueo al otorgar**.
   ⏭️ Diferido a fases posteriores: columnas "Sin Liquidar"/"Pago en Fecha" (dependen de Caja,
   Fase 3), **recargos** (dependen de config, Fase 7) y "eliminar cuota" (integridad financiera).
3. **Caja y liquidación:** ✅ HECHA — `settlement` encadenada (caja anterior→actual, cuadre en
   dominio puro; **ventana → re-cierre seguro** sin doble conteo), **gastos maker-checker**,
   Reporte diario, Lista Liquidadas; columnas "Sin Liquidar"/"Pago en Fecha" del Listado de
   Cuentas habilitadas. Smoke E2E verde. ⏭️ Pendiente: `audit_log` transversal + `Idempotency-Key`
   HTTP (deuda §21), liquidada por ruta/cobrador (Fase 4) y "cuentas terminadas" con `settled_at`.
4. **Rutas y aprobaciones:** ✅ HECHA — `change_request` (**Solicitud Modificar Cliente**,
   maker-checker: cobrador propone → socio aprueba y se aplica al cliente) y **"Lista de cobros"**
   (read-model que reusa Zoning+collector: cobrador + zonas + nº de clientes). Smoke E2E verde.
   ⏭️ Pendiente: "última liquidada" por ruta (requiere liquidada por cobrador, extensión de Fase 3)
   y alcance del cobrador a solo sus clientes asignados al proponer cambios.
5. **Geo / Tracking:** ✅ HECHA — recorrido GPS del cobrador (`collector_location`), "Lugar último
   registro", "Posición de Clientes" (deudores por estado: sin préstamos/al día/atraso) + registro
   de ubicación. Smoke E2E verde. UI **sin librería de mapas** (listas + `navigator.geolocation`).
   Bonus: `ZodExceptionFilter` global (validación → 400 en toda la app). ⏭️ Pendiente: mapa visual
   (`react-native-maps`/`expo-maps`) y GPS nativo (`expo-location`) — requieren autorizar deps.
6. **Segmentación:** ✅ HECHA — listas personalizadas (`borrower_list`/`borrower_list_member`),
   alta masiva idempotente, "asignar a lista" desde clientes; el "filtro" reusa el listado de
   clientes. Smoke E2E verde.
7. **Config por tenant:** ✅ HECHA — `tenant_config.operational_settings` (recargos, comisión,
   cupo por defecto, bloqueos); pantalla de configuración (ADMIN) en Ajustes; **cupo por defecto
   aplicado al crear cliente**. Smoke E2E verde. ⏭️ Pendiente: enforcement de recargos/comisión en
   el cuadre de caja y bloqueos en ventas (cuando se necesiten).
8. **Reporting (CQRS):** ✅ HECHA — panel del tenant (`/reports/dashboard`), resumen de cliente
   (`/borrowers/:id/summary`) y export CSV del listado de cuentas (`/reports/accounts-export`,
   "Generar Tarjetas"). Sin tablas nuevas (proyecta sobre lo existente). Smoke E2E verde. ⏭️
   Pendiente: export PDF/Excel y guardar/compartir en nativo (requieren autorizar deps:
   pdf/exceljs, expo-file-system/expo-sharing); los mapas visuales son la mejora de Fase 5.

---

## ✅ Estado: paridad funcional alcanzada (Fases 1–8)

Las 8 fases del roadmap están implementadas full-stack (dominio → contrato → API → Expo), con
pruebas unitarias de dominio y **smoke E2E verde** por fase.

**Transversales críticos RESUELTOS** (ADR #29, deuda §21): `audit_log` append-only +
`Idempotency-Key` HTTP (interceptores globales en `apps/api/observability`; migración 0026; smoke
E2E verde).

**Fase 9 — WhatsApp/Solicitudes por ZONA (ADR #30):** `whatsapp_channel` (número→zona), `zone_path`
estampado en conversaciones/solicitudes, **bandeja de conversaciones** (vista 1) y **revisión de
solicitudes** (vistas 2/3, ya existentes con antifraude/imágenes/aprobar-rechazar) **scopeadas por
zona** (ADMIN/COORDINATOR), filtro en-proceso/completas, y **histórico de rechazos**
(`credit_application_rejection`, motivo obligatorio). Migración 0027; smoke E2E backend 12/12.

Pendientes transversales restantes: enforcement de recargos/comisión en el cuadre de caja y bloqueos
en ventas; pruebas de aislamiento RLS (Testcontainers); scope del documento original por zona; y las
mejoras que requieren **autorizar dependencias** (mapas/`expo-location`, PDF/Excel,
`expo-file-system`/`expo-sharing`).

## 7. Estructura por slice (réplica del slice de Crédito)

```
domain/<ctx>/<regla>.ts (+ .test.ts)        reglas puras, invariantes
application/<ctx>/<caso>.ts                  Handler + puerto (interface Repository)
contracts/src/<ctx>.ts                       ts-rest + zod
db/src/schema/<tabla>.ts + migración RLS     pnpm db:generate
api/src/<ctx>/{controller,repository,module}
mobile/src/features/<ctx>/{api,screens}      React Query sobre client ts-rest
```

## 8. Riesgos / qué NO romper

- **Migración de `borrowerId`** a `borrower` (backfill + FK al final): punto más delicado.
- **RLS por tabla:** repetir el bloque; introducir prueba de aislamiento (Testcontainers, deuda §21).
- **No tocar** Conversations/KYC/Antifraude/Payments salvo para enlazar `borrower`.
- **Idempotencia de dinero** (gastos, liquidación) debe resolverse antes de la Fase 3.
- **Mapas/export** pueden requerir libs nuevas → decisión a autorizar, no se instala por defecto.

---

## 9. Fase 10 — Planes de Pago + negociación por WhatsApp (NUEVO)

> *Cómo* en ARCHITECTURE.md; este apartado fija las **decisiones funcionales** del módulo.

**Aggregate nuevo `payment_plan`** (por tenant): plantilla de crédito ofertable (nº cuotas,
frecuencia, interés base-mil, `is_active`, `is_default`). Invariante duro: **exactamente un
`is_default` por tenant** (índice parcial único `WHERE is_default` + caso de uso que impide
borrar/desactivar/quitar-default al único default → siempre ≥ 1).

**Botón azul partido en dos pasos** (sin tocar el `status` KYC del expediente; la oferta es una
**sub-máquina** `plan_offer_status` sobre `credit_application`):

1. **Ofertar** (`POST /applications/:id/plan-offer`). Según el toggle de tenant
   `clientChoosesPlan`: **ON** → WhatsApp con el menú de planes activos (espera selección);
   **OFF** → toma el `is_default`, proyecta el cronograma (reusa `buildSchedule` +
   `scheduleDueDates`) y pide aceptación.
2. **Crear crédito** (`POST /applications/:id/approval`, ADMIN/COORDINATOR) → genera `credit` +
   `installment`s con los términos del plan ofertado.

### Decisiones de este aporte

- **Override del administrador:** si el cliente **no responde**, el botón final (botón azul / "Crear
  crédito") **igual puede ejecutarse** por ADMIN/COORDINATOR. El caso de uso acepta el override
  explícito (la decisión queda en `credit_application_event` como `ADMIN_OVERRIDE`, append-only);
  sin override exige la bandera `ACCEPTED`. La aceptación del cliente sigue siendo el camino feliz.
- **Vencimiento de la oferta = 1 día, parametrizable por tenant:** nuevo ajuste operativo
  `planOfferTtlHours` (default **24**) en `OperationalSettings`. Al ofertar se sella
  `offer_expires_at = now() + ttl`. Pasado el vencimiento, la respuesta del cliente por WhatsApp se
  ignora (se le re-oferta) y el coordinador puede re-ofertar o aplicar el override.
- **Toggle de autonomía** `clientChoosesPlan` (default OFF) también en `OperationalSettings`.

**Orden de entrega (slices):** (1) `payment_plan` (dominio+test+contrato+handler+repo+controller+
pantalla con toggles) ✅; (2) toggles de tenant (`clientChoosesPlan`, `planOfferTtlHours`,
`allowAdminOverride`) en `OperationalSettings` + UI en Configuración de cobro ✅ (migración 0029,
default jsonb; `get` mezcla sobre defaults para filas previas); (3) sub-máquina de oferta
(`plan_offer_status` + columnas en `credit_application`, migración 0030) + `OfferPlansHandler`
(botón azul: menú o cronograma según toggle, TTL del tenant) + notifier WhatsApp (reusa
`WhatsappTextSender`) + panel de oferta en el detalle de revisión ✅; (4) respuestas del cliente
(webhook): parser puro `parsePlanSelection`/`parseAcceptance`, `RecordPlanReplyHandler` (interceptor
previo al asistente en `WhatsappTextConsumer`; idempotente por wamid; respeta `offer_expires_at`;
sella PLAN_SELECTED/CLIENT_ACCEPTED/CLIENT_DECLINED en `credit_application_event`) ✅; (5) guarda de
bandera/override en `approval` + `payment_plan_id` en `credit` ✅ (`ApproveApplicationReviewHandler`
con puertos opcionales de plan+config: exige `ACCEPTED` salvo `allowAdminOverride`, toma términos del
plan ofertado + `offeredPrincipalMinor`, audita el override; migración 0031); (6) pantalla de créditos
(gestión de Cuentas) ✅ — se EXTIENDE el read-model existente `accounts`: filtro adicional por
**teléfono** (`listAccountsQuery.phone` + `ilike` en repo + input en la lista) y **plan pactado**
(`accountDetail.planName` vía join a `payment_plan` por `credit.payment_plan_id`). El detalle ya
traía cronograma de cuotas con colores, registro de abonos (`PaymentsList`) y mora (`daysOverdue` +
deuda). Sin migración nueva.

**Fase 10 COMPLETA** (verticals 1–6): planes de pago CRUD con default único, toggles de tenant,
botón azul (oferta menú/cronograma), respuestas del cliente por webhook, creación con bandera/override
y términos del plan, y gestión de créditos con filtros (nombre/cédula/teléfono) + detalle
(plan + cuotas + abonos + mora). Migraciones 0028–0031.

---

## 10. Fase 11 — Originación asistida (monto WhatsApp + zona/deudor automáticos)

Mejora del flujo de originación sobre la Fase 10. Cuatro piezas:

1. **Monto por WhatsApp** — el bot pregunta "¿Cuánto dinero deseas solicitar?" al iniciar la
   solicitud; `RecordAmountReplyHandler` (interceptor previo al asistente, idempotente por wamid)
   captura el número y lo sella en `credit_application.requested_amount_minor` (migración 0032);
   luego pide el primer documento. El coordinador lo ve en la revisión y aprueba el capital que
   decida.
2. **Zona automática** — el detalle de revisión resuelve `zoneId` desde `zone_path` (mapeo
   línea→zona de la Fase 9); en el modal la zona es de **solo lectura** (sin UUID a mano).
3. **Deudor desde OCR / existente** — el detalle expone `extractedIdentity` (cédula/nombre del
   `document_extraction` vía `mapIdentityFields` + `splitFullName`). En el modal, `BorrowerPicker`
   crea el cliente desde el OCR (un clic → `createBorrower`) o elige uno existente por búsqueda
   (`listBorrowers`), fijando el `borrowerId`.
4. **Bloqueo de aprobación** — "Aprobar y generar crédito" queda **disabled** hasta que haya
   `borrowerId` (creado o seleccionado) y `zoneId` resuelto.

Sin DDL a mano (solo `requested_amount_minor`, migración 0032). Reusa OCR, borrower CRUD/búsqueda y
el mapeo número→zona ya existentes; el contrato de `approveApplication` no cambió.
