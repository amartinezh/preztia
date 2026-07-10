# PreztiaOS — Informe de depuración (código muerto y características prescindibles)

> **Fecha:** 2026-07-09. **Alcance:** `apps/api`, `apps/mobile`, `packages/{domain,application,contracts,db,ui,config}`, `deploy/landing`, docs.
> **Antecedente:** el sistema se diseñó buscando paridad con un sistema legado (concuo); varias de
> esas características no aportan al **core real: el flujo de cobro** (otorgar → cobrar → registrar
> → cuadrar caja → mostrar la información). Este informe separa lo que se puede **borrar ya**, lo
> que está **a medio cablear** (decidir: terminar o podar) y lo que es **funcionalidad legado de
> valor dudoso** (decisión de producto).
> **Método:** análisis estático cruzado en 4 planos — rutas Expo → pantallas; operaciones de
> contrato ts-rest → hooks del cliente → controllers NestJS; símbolos exportados de
> `domain`/`application` → consumidores reales (excluyendo tests e index); tablas Drizzle →
> repositorios. Ver §8.

---

## 0. Resumen ejecutivo

| Categoría | Ítems | Acción |
|---|---|---|
| §1 Código muerto confirmado | 8 grupos de archivos/símbolos | Borrar (PR quirúrgico, riesgo ~0) |
| §2 Flujos a medio cablear (API viva, UI inexistente) | 9 flujos | Decidir: terminar o podar contrato+API+hook |
| §3 Características legado de valor dudoso | 5 features | Decisión de producto |
| §4 Reglas de dominio sin aplicar | 4 reglas | **No es limpieza: es control faltante** — cablear o eliminar |
| §5 Limpieza menor | boilerplate, exports, docs | Barrido de bajo riesgo |

El patrón dominante: las Fases 1–8 de paridad con el legado entregaron slices completos
(dominio→contrato→API→pantalla), pero la posterior consolidación de UI (Cartera unificada, hub de
Cuentas, ajustes en pestañas) dejó **huérfanos** pantallas, hooks y endpoints del diseño anterior
sin retirarlos.

---

## 1. Código muerto confirmado — borrar ya

Nada de esto tiene un consumidor en producción (verificado por búsqueda de referencias en todo el
monorepo, excluyendo tests y re-exports de `index.ts`).

| # | Qué | Evidencia | Al borrar, arrastra |
|---|---|---|---|
| 1.1 | `apps/api/src/app.controller.ts`, `app.service.ts`, `app.controller.spec.ts` | Boilerplate de NestJS; `AppController` **ni siquiera está registrado** en `AppModule` (solo `CreditController`) | — |
| 1.2 | `apps/api/src/payments/banking/null-bank.verifier.ts` (`NullBankVerifier`) | No está registrado en `bank-verifier.registry` ni en ningún módulo | — |
| 1.3 | `apps/mobile/src/features/credit/screens/credit-list-screen.tsx` (`CreditListScreen`) | Ninguna ruta lo importa; lo reemplazó `PortfolioScreen` (Cartera unificada) | `useCreditsList` (su único consumidor) → y con él, `GET /credits` (`listCredits`): contrato, `CreditController.list` y `CreditQueryRepository.listCredits` quedan sin cliente (la Cartera lee `GET /accounts`) |
| 1.4 | `apps/mobile/src/features/accounts/screens/accounts-list-screen.tsx` (`AccountsListScreen`) | Ninguna ruta lo importa; lo reemplazó `PortfolioScreen` | — |
| 1.5 | `useCollectorTrack` en `apps/mobile/src/features/tracking/api/queries.ts` | Ninguna pantalla lo usa | Ver §3.2 (tracking completo) |
| 1.6 | `useRegisterWithdrawal` y `useTransfer` en `apps/mobile/src/features/cash/api/boxes-queries.ts` | Ninguna pantalla los usa (`cash-movements-screen` es solo lectura) | Ver §2.4 |
| 1.7 | `institutionForIspb` en `packages/domain/src/credit/payment/ispb-registry.ts` | Cero referencias (ni tests); `isKnownIspb` sí está vivo — solo se borra la función | — |
| 1.8 | Funciones de dominio vivas **solo por sus tests**: `decideApplicationReview`, `recordDocumentOutcome`, `isComplete` (`credit-application.ts`); `dueOnDateMinor` (`portfolio/account.ts`); `boxBalanceMinor` (`cash/cash-box.ts`) | La capa de aplicación usa `recordDocumentResult`/`nextDecisionStatus`/`nextPendingDocument`; estas variantes quedaron de una iteración anterior | Sus casos de prueba |

---

## 2. Flujos a medio cablear — endpoint + contrato vivos, UI inexistente

Cada fila es un flujo completo (contrato ts-rest + controller + handler) que **ningún cliente
llama**. Mantenerlos tiene costo real: superficie de ataque autenticada, mantenimiento y ruido.
Recomendación por defecto: **podar** (contrato + controller + handler + hook muerto); terminar solo
lo que el negocio pida.

| # | Flujo | Piezas sin consumidor | Observación / recomendación |
|---|---|---|---|
| 2.1 | **Refresh de sesión** | `POST /auth/refresh`; el cliente guarda `refreshToken` en `token-storage(.web).ts` pero **nunca lo usa** — al expirar el JWT hace logout (`notifyUnauthorized`) | El único de esta lista que probablemente conviene **terminar, no podar**: sesiones que expiran a mitad de ruta de cobro obligan a re-login en campo. Cablear el refresh en `fetcher.ts` o eliminar emisión+almacenamiento del refresh token |
| 2.2 | **Notas de cobro del cliente** (legado Fase 1) | `GET/POST /borrowers/:id/notes`, tabla `borrower_note`, `AddBorrowerNoteCommand`, `listBorrowerNotes`/`addBorrowerNote` | Cero UI. Podar slice completo (contrato, controller, handler, tabla vía migración, dominio `borrower-note`) o priorizar UI si cobradores las necesitan |
| 2.3 | **Miembros de listas** | `GET /borrower-lists/:id/members`, `DELETE .../members/:borrowerId` | Se pueden crear listas y agregar clientes desde el listado, pero **nadie puede ver ni quitar miembros** → la segmentación es write-only e inservible hoy (ver §3.1) |
| 2.4 | **Movimientos manuales de caja** | `POST /cash/boxes/:id/movements` (`registerCashMovement`, ni hook tiene), `POST /cash/boxes/:id/withdrawals`, `POST /cash/transfers` (hooks muertos, §1.6) | El ledger vive: lo alimentan pagos (`payment-box-router`) y arqueo/sync. Los asientos manuales no tienen pantalla. Podar los 3 endpoints o añadir la UI si el flujo de caja los requiere |
| 2.5 | **Desactivar usuario** | `DELETE /users/:id` (`deactivateUser`, `DeactivateUserHandler`) | Sin botón en Usuarios (pestaña de Ajustes). Riesgo operativo: no hay forma de sacar a un cobrador que se va. Terminar (bajo costo) o podar |
| 2.6 | **Editar zona** | `PATCH /zones/:id` (`updateZone`) — ni hook existe en el cliente | Podar o completar CRUD de zonas |
| 2.7 | **Coordinador por zona** | `POST /zones/:id/coordinators` (`assignCoordinator`, `AssignCoordinatorHandler`, hook `useAssignCoordinator` muerto), tabla `zone_coordinator` | **El alcance real por zonas NO usa esta tabla**: `zone-scope.ts` filtra por `session.zonePaths` (JWT ← `app_user.zone_paths`). `zone_coordinator` solo la escribe este endpoint sin UI y la lee `listZones` para adornar el listado. Es el mecanismo legado reemplazado → podar tabla + endpoint + handler |
| 2.8 | **Último registro del cobrador** | `GET /collectors/:id/last-location` (`getCollectorLastLocation`) | Pantalla legado "Lugar último registro" nunca construida en la UI nueva. Ver §3.2 |
| 2.9 | **Conciliación de liquidaciones MP** | `POST /payments/reconcile-settlement` | Solo lo invoca a mano el seed demo (`seed-mercadopago-demo.ts`); el comentario en `payments.module.ts` dice "listo para un cron por tenant" que no existe. Si Mercado Pago sigue en el roadmap: crear el cron (como el de recordatorios). Si no: podar junto con la decisión de §3 |

---

## 3. Características legado de valor dudoso frente al core de cobro

Funcionan (total o parcialmente) pero no alimentan el flujo de cobro. Decisión de producto, no
técnica; el informe solo dimensiona qué arrastraría cada poda.

### 3.1 Segmentación / Listas personalizadas (Fase 6) — hoy inservible
Estado real: crear lista ✅, borrar lista ✅, agregar clientes desde el listado ✅… pero **ver o
quitar miembros no existe** (§2.3). Una lista a la que no se puede consultar no segmenta nada.
- **Podar:** `features/lists`, ruta `/lists`, botón en `borrowers-screen`, `useAddListMembers`,
  contrato `borrower-lists.ts`, `borrower-lists.controller.ts`, handlers `application/borrowers/lists`,
  dominio `borrower-list.ts`, tablas `borrower_list`/`borrower_list_member` (migración).
- **Terminar:** una pantalla de detalle de lista (miembros + quitar) — es lo único que falta.

### 3.2 Tracking GPS del cobrador (Fase 5) — se escribe, nadie lo lee
Estado real: `POST /me/locations` (botón "registrar ubicación" en Mis clientes) escribe
`collector_location`; **los dos endpoints de lectura están muertos** (recorrido §1.5 y último
registro §2.8). Se acumulan datos GPS (PII sensible) que ninguna vista muestra — lo contrario de
"controlar y mostrar la información", y un pasivo de privacidad (§3.7 ARCHITECTURE: minimización).
- La "Posición de Clientes" (`GET /clients/positions`, pestaña Operación) sí está viva y **no
  depende** de `collector_location`.
- **Podar:** `getCollectorTrack` + `getCollectorLastLocation` + `useCollectorTrack` + tabla y
  registro de ubicación, o **Terminar:** dibujar el recorrido en el mapa de cobro (MapLibre ya está).

### 3.3 Detalle de crédito duplicado
Dos pantallas de detalle conviven: `account-detail-screen` (`/account/:creditId`, la que usa la
Cartera; read-model completo con plan, mora, abonos, sección de cobro) y `credit-portfolio-screen`
(`/credit/:id`, la vieja; cuotas vía `GET /credits/:creditId/portfolio`). La vieja solo es alcanzable
por el redirect post-aprobación en `application-review-detail-screen.tsx:58`.
- **Recomendación:** redirigir la aprobación a `/account/${creditId}` y podar
  `credit-portfolio-screen`, `useCreditPortfolio` y el endpoint `getCreditPortfolio` (contrato +
  controller). Junto con §1.3, el slice viejo de "Créditos" desaparece completo.

### 3.4 Módulo News ("pulso del sector")
`apps/api/src/news` (controller público + cron RSS) sirve **solo a la landing** (`deploy/landing/app.js`).
No toca tenants ni BD y no es parte del producto. No es código muerto, pero es un cron + fetch a
feeds externos viviendo dentro del API transaccional de una fintech. Opciones: dejarlo (costo bajo),
o sacarlo del API (generar el JSON estático en el deploy de la landing).

### 3.5 KPIs de dashboard con datos de mentira
`features/dashboard/api/queries.ts` usa `placeholderData: mockDashboardKpis`. Consecuencia: si
`GET /dashboard/kpis` falla, la pantalla **muestra los números del mock como si fueran reales** y el
banner de error nunca aparece (el guard `query.isError && !kpis` no dispara porque `kpis` es el
placeholder). Para el panel financiero de un sistema de cobro esto es peor que una pantalla vacía.
- **Recomendación:** eliminar `data/mock.ts` y el `placeholderData` (o limitarlos a `__DEV__`), y
  mostrar el error real.

---

## 4. Reglas de dominio escritas pero sin aplicar — control faltante, no limpieza

Estas existen en `@preztiaos/domain`, tienen pruebas verdes… y **ningún caso de uso las invoca**.
El checklist del proyecto exige que los invariantes se apliquen, no solo que existan. Cablear o
eliminar, pero no dejarlas dando falsa confianza:

| Regla | Qué debería controlar | Estado real |
|---|---|---|
| `creatableRoles` (`iam/role.ts`) | Jerarquía de provisión (quién puede crear qué rol) | `users.controller.ts` la re-implementa a mano con `requireRole(USER_MANAGER_ROLES/ADMIN_ONLY)`; la regla de dominio solo la ejecutan sus tests |
| `canTransitionTenant` + estado `SUSPENDED` (`iam/tenant.ts`) | Suspensión de tenants morosos | **Ningún código del API menciona `SUSPENDED`**: no se puede suspender un tenant ni el login lo verifica. El enum `tenant_status` es decorativo |
| `isControlPlane`, `ROLES` (`iam/role.ts`) | Vocabulario del plano de control | Solo tests |
| `isWithinScope`/`assertValidLabel` (`zone-path.ts`) | Alcance por subárbol en dominio puro | Solo uso interno del archivo; el predicado real es SQL (`zone-scope.ts`) — coherente, pero decidir cuál es la fuente de verdad |

---

## 5. Limpieza menor (bajo riesgo, un solo PR de barrido)

- **Boilerplate Expo:** `apps/mobile/scripts/reset-project.js` + script `reset-project` en
  `package.json` (plantilla de create-expo-app).
- **Exports innecesarios** (símbolos usados solo dentro de su propio archivo; quitar `export` reduce
  la superficie pública): `mod10CheckDigit`, `mod11CheckDigit`, `parseLinhaDigitavelConvenio`,
  `UTILITY_SEGMENTS` (febraban), `normalizeName`/`namesMatch` (normalize-name), `KNOWN_ISPB`,
  `BORROWER_COLORS`, `TENANT_STATUSES`, `BORROWER_POSITION_STATUSES`, `DEFAULT_PLAN_OFFER_TTL_HOURS`,
  `MIN/MAX_PLAN_*`, `toIsoDate`/`toMinorUnits`/`toPartnerNames`, y los tipos `*Command` de
  application que ningún controller importa.
- **Docs/config desactualizados:**
  - `CLAUDE.md` dice "pnpm dev — api + **web** + watchers": no existe `apps/web` (el cliente
    universal es Expo).
  - `turbo.json` declara outputs `.next/**`: no hay app Next.js.
  - Diagrama de `DESIGN.md` §3 marca Reporting como `todo` (rojo) cuando la Fase 8 está entregada.
- Al ejecutar §1.3 + §3.3, revisar `test/preztiaos.postman_collection.json` para retirar las
  requests de los endpoints podados.

## 6. Falsos positivos — NO borrar

Para que el barrido no se pase de la raya:

- **Variantes de plataforma** `*.web.ts(x)` (`collection-map.web.tsx`, `token-storage.web.ts`,
  `animated-icon.web.tsx`, `use-color-scheme.web.ts`): Metro las resuelve por sufijo; parecen
  huérfanas para cualquier grep de imports.
- **Endpoints sin cliente interno pero con caller externo:** webhooks de WhatsApp
  (`GET/POST /webhooks/whatsapp`), PicPay y Mercado Pago (`POST /webhooks/{picpay,mercadopago}/:tenantId`),
  `GET /public/news` (landing), `GET /payments/:id/receipt` y
  `GET /applications/:id/documents/:tipo/original` (el cliente los consume con `fetch` crudo para
  binarios, no vía ts-rest).
- **`packages/config`**: no lo importa ningún `.ts` porque es la base compartida de
  tsconfig/eslint — vivo como tooling.
- **`payment_charge` / `provider_webhook_event` / `incoming_credit`**: una sola referencia cada
  una, pero es real (consumer de WhatsApp, webhooks PIX).
- **Seeds** (`apps/api/scripts/seed-*.ts`) y la colección Postman: tooling de desarrollo.
- Los exports `*Keys` de los `api/queries.ts` del cliente: se usan dentro de su archivo para las
  query keys.

---

## 7. Plan de depuración propuesto (PRs quirúrgicos, en orden)

1. **PR-1 — Muerto duro (sin decisión de producto):** §1 completo + §5 boilerplate/exports/docs.
   Verificación: `pnpm typecheck && pnpm test && pnpm build` — ninguna pantalla ni endpoint vivo
   cambia de comportamiento.
2. **PR-2 — Consolidar detalle de crédito (§3.3):** cambiar 1 redirect, podar pantalla vieja +
   `getCreditPortfolio` + `listCredits` (cierra el slice legado de Créditos).
3. **PR-3 — Podar mecanismo legado de coordinadores (§2.7):** endpoint + handler + hook + columna
   en `listZones` + tabla `zone_coordinator` (migración con `pnpm db:generate`).
4. **Decisiones de producto (una por una, terminar o podar):** refresh de sesión (2.1 — sugerido
   terminar), desactivar usuario (2.5 — sugerido terminar), notas de cliente (2.2), listas (3.1),
   tracking GPS (3.2), movimientos manuales de caja (2.4), editar zona (2.6), cron de
   reconcile-settlement (2.9), news fuera del API (3.4).
5. **PR de control (no depende de producto):** mock del dashboard (3.5) y reglas de dominio sin
   aplicar (§4): suspender tenant debería, como mínimo, bloquear el login.
6. Las tablas solo se eliminan **al final** de cada poda funcional y siempre vía esquema Drizzle +
   `pnpm db:generate` (regla del repo); `borrower_note`, `borrower_list*`, `zone_coordinator` y
   `collector_location` son las candidatas según lo que se decida en (4).

## 8. Método de verificación (reproducible)

Todo hallazgo salió de cruces de referencias sobre el código fuente (sin ejecutar la app):

1. **Pantallas:** cada archivo bajo `apps/mobile/src/{features,components,core}` se buscó como
   especificador de import en el resto del cliente; los `href`/`router.push` se cotejaron contra
   `apps/mobile/src/app/**`.
2. **Endpoints:** se extrajo (método, path) de cada operación `c.router` en
   `packages/contracts/src/*.ts` y se cotejó contra los decoradores `@Get/@Post/...` de
   `apps/api/src/**`; el consumo del cliente se midió buscando `api.<operación>` (el cliente ts-rest
   aplana todos los contratos en `core/api/client.ts`).
3. **Dominio/aplicación:** cada `export` de `packages/{domain,application}` se clasificó en
   VIVO / SOLO-INTERNO / SOLO-TESTS / MUERTO según dónde aparecen sus referencias.
4. **Tablas:** cada `pgTable` de `packages/db/src/schema` se buscó en `apps/api` y
   `packages/application`, y para las de una sola referencia se siguió el flujo a mano.

Cualquier ítem se puede re-verificar con `grep -rw <símbolo> apps packages --include='*.ts*'`
excluyendo `*.test.ts`, `*.spec.ts` y los `index.ts` de re-export.
