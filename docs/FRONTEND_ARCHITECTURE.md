# PreztiaOS — Arquitectura Frontend (Expo iOS/Android/Web)

> **Estado:** documento vivo. Complementa [ARCHITECTURE.md](ARCHITECTURE.md) (fuente de verdad del sistema).
> **Ámbito:** la app cliente `apps/mobile` (Expo SDK 56 + Expo Router + NativeWind v4) y el design system `@preztiaos/ui`.
> **Última actualización:** 2026-11-08 (Fases 0, 1 y 2 de usabilidad, ADR #50, #51 y #52: `MoneyInput`, `ConfirmModal`, `ToastProvider`, mapa de errores de zod, cola offline con fallidas visibles, sesión con refresco, "Mis cobros de hoy", búsqueda unificada `q`).

Esta guía define **cómo se escribe el frontend** para cumplir —y demostrar— los atributos de
calidad vinculantes de [§3](ARCHITECTURE.md#3-atributos-de-calidad-y-estándares-de-código) y
[§3.7](ARCHITECTURE.md#37-atributos-de-calidad-del-sistema--ilities) del documento de arquitectura.
Una sola base de código corre en **iOS, Android y Web** (ADR #7).

---

## 1. Principios

1. **SRP por capa, igual que el backend.** La presentación no llama `fetch`, no arma headers
   ni contiene reglas; cada pieza tiene una sola razón para cambiar (tabla §2).
2. **Contract-first.** Los formularios validan con el **mismo zod de `@preztiaos/contracts`**;
   los hooks de datos derivan del cliente tipado ts-rest. No hay tipos de API duplicados.
3. **Identidad desde el JWT.** El `tenantId`, el rol y las zonas se **derivan de los claims**
   del access token, nunca de input del usuario ni de un header manipulable.
4. **Dinero en unidades menores.** La UI captura unidad mayor y convierte a entero menor en la
   frontera; el formateo es solo presentación (`MoneyText` / `formatMoney`).
5. **Diseño para el cambio.** Un *bounded context* nuevo replica la estructura del slice de
   Crédito (api → schemas → components → screens → ruta delgada).

---

## 2. Capas y responsabilidades (espejo de §3.1)

| Pieza | **Sí** hace | **No** hace |
|---|---|---|
| **Ruta** (`src/app/**`) | compone pantalla + layout; `(tabs)/_layout.tsx` decide el **menú por rol** (`can(role, …)`) | fetch, reglas, estilos ad-hoc |
| **Screen** (`features/*/screens`) | orquesta hooks de datos + componentes de UI | transporte HTTP, headers, validación cruda |
| **Hook de datos** (`features/*/api`) | React Query: query/mutation, caché, clave de idempotencia | render, navegación |
| **Cliente API** (`core/api`) | transporte: `Authorization`, `correlationId`, `Idempotency-Key`, timeout, backoff | reglas de negocio, UI |
| **Sesión/Auth** (`core/auth`) | decodifica JWT, deriva tenant/rol/zonas, almacenamiento seguro | confiar en el usuario para el tenant |
| **Componente UI** (`@preztiaos/ui`) | presentacional, accesible, responsivo | fetch, dominio, conocer contratos |
| **Schema** (`features/*/schemas` / contrato) | valida en la frontera (zod del contrato) | lógica de dominio |

> 🚨 **Señales de violación:** una pantalla que llama `fetch`; un componente de `@preztiaos/ui`
> que importa de `features/*` o de contratos; un hook que renderiza; el tenant tomado de un input.

---

## 3. Estructura

```
packages/ui/                      # @preztiaos/ui — design system (sin dominio, sin contratos)
  src/tokens, format, hooks, primitives, components, feedback

apps/mobile/src/
  app/                            # SOLO rutas Expo Router (delgadas)
    _layout.tsx                   # providers + Stack.Protected (guards de sesión)
    sign-in.tsx                   # acceso (grupo no autenticado)
    (app)/                        # área autenticada
      _layout.tsx                 # Stack + banner offline + registro de ejecutores
      (tabs)/                     # navegación raíz consciente de rol
      credit/[id].tsx, credit/new.tsx, payment/[creditId].tsx
  core/                           # infraestructura agnóstica (sin UI, sin dominio)
    api/      # cliente ts-rest + fetcher transversal + unwrap + request-context
    auth/     # jwt, token-storage(.web), auth-state, session, authorization
    query/    # queryClient (retry policy)
    offline/  # cola de mutaciones persistida + sync
    errors/   # ApiError + normalización HTTP→clave i18n
    i18n/     # diccionarios es / pt-BR
    logger/   # logs estructurados con redacción de PII
    form/     # useZodForm (contract-first sin libs nuevas)
    env/      # configuración EXPO_PUBLIC_*
  features/                       # un folder por bounded context
    auth/ credit/ payments/ settings/ applications-review/   # api/ · schemas/ · components/ · screens/
    tenants/ users/ zones/ collectors/ clients/             # IAM (slices por rol)
```

**Grafo de dependencias (hacia abajo):** `mobile/app → features → core → contracts`;
`features/components → @preztiaos/ui`; `@preztiaos/ui → react-native + nativewind` (nada de negocio).

---

## 4. Cumplimiento de los atributos de calidad del sistema (§3.7)

| Atributo | Dónde vive en el front |
|---|---|
| **Seguridad** | `core/auth/jwt.ts` deriva tenant/rol/zonas de los claims (el `SUPER_ADMIN` viaja con `tenantId` vacío); `core/api/fetcher.ts` envía `Authorization: Bearer` y, en 401, `core/auth/session.tsx` cierra sesión y limpia caché; `core/auth/authorization.ts` (espejo de `domain/iam/role`) decide el **menú por rol** y oculta/inhabilita acciones; el **plano de control** (tenants) no envía `x-tenant-id`; token en `expo-secure-store` (nativo) / `localStorage` (web). |
| **Auditabilidad** | `core/api/fetcher.ts` añade `X-Correlation-Id` por petición; se muestra en banners de error y se incluye en los logs del cliente. |
| **Idempotencia** | `core/ids.ts` + `core/api/request-context.ts`: cada mutación de dinero lleva `Idempotency-Key` estable; la cola offline persiste la MISMA clave para reenvíos (sin doble abono). |
| **Observabilidad** | `core/logger/index.ts`: JSON con `tenantId`+`correlationId`, **redacción de PII** (nombre/CPF/token). |
| **Resiliencia** | `core/api/fetcher.ts`: timeout + backoff exponencial en GET; `core/offline/queue.ts`: cola persistida; `@preztiaos/ui` `Banner`/`ErrorBoundary` para degradación elegante. |
| **Rendimiento** | listados con `useInfiniteQuery` + `paginationQuery` del contrato; sin *load-all*; virtualización (`FlatList`). |
| **Privacidad** | la UI solo muestra campos enmascarados del contrato (`payerTaxIdMasked`); la PII nunca se loguea. |
| **Integridad financiera** | `majorToMinor`/`minorToMajor` convierten en la frontera; el dinero viaja como entero menor. |

---

## 5. Cómo añadir un nuevo slice (bounded context)

1. **Contrato** en `@preztiaos/contracts` (zod + ts-rest) y `pnpm --filter @preztiaos/contracts build`.
2. **Hooks** en `features/<ctx>/api` con `unwrap(await api.x(...))` + `tenantHeader()`.
3. **Schemas** reusando el zod del contrato (`useZodForm` o `schema.safeParse`).
4. **Componentes** con primitivos de `@preztiaos/ui` (sin estilos sueltos).
5. **Screens** que orquestan hooks + componentes; **rutas** delgadas en `app/(app)/...`.
6. **Pruebas** de la lógica pura (mapeos, conversión, gating) e invariantes.
7. **Verde** en `typecheck + lint + test + build` (§17 ARCHITECTURE.md).

---

## 6. Verificación

```bash
pnpm build && pnpm typecheck && pnpm test         # pipeline (definición de "correcto")
pnpm --filter @preztiaos/mobile web               # web responsiva (breakpoints, modo oscuro)
pnpm --filter @preztiaos/mobile ios               # iOS (safe areas, tabs nativas)
pnpm --filter @preztiaos/mobile android           # Android (host 10.0.2.2)
npx expo export --platform web                     # valida el bundle Metro + árbol de rutas
```

**Chequeos manuales clave:** sin JWT → redirige a `sign-in` y la API responde 401; las peticiones
llevan `Authorization`, `X-Correlation-Id` e `Idempotency-Key`; los logs no contienen PII; en modo
avión un abono se encola y se reenvía **una sola vez** al recuperar red (sin doble abono).

---

## 7. Convenciones de usabilidad (Fase 0, ADR #50)

Nacen del informe [INFORME_USABILIDAD.md](INFORME_USABILIDAD.md). Son obligatorias en toda pantalla nueva o tocada.

| Regla | Cómo se cumple |
|---|---|
| **El dinero nunca se convierte en silencio.** | Todo monto tecleado usa `MoneyInput` (`@preztiaos/ui`): guarda el TEXTO en estado y recibe el entero menor por `onChangeAmount` (`null` = inválido/ambiguo). El botón de enviar va `disabled` mientras sea `null`. Prohibido `Number(texto) \|\| 0`. |
| **Lo irreversible se confirma con un resumen.** | `ConfirmModal` con título, qué va a pasar (montos con `formatMoney`, fechas, "no se puede deshacer") y `tone="danger"` para borrar o sellar. |
| **Toda mutación responde.** | `useToast().show({ tone, title, description })` al terminar (éxito, encolado sin señal, error). Si la pantalla navega al éxito, el toast va antes de `router.back()`. `Alert.alert` está prohibido (no-op en web). |
| **Reintentar el mismo intento no duplica dinero.** | La pantalla genera la `Idempotency-Key` una vez por intento de formulario (`useState(() => newIdempotencyKey())`), la pasa en las variables de la mutación y la renueva solo tras éxito. El hook la envía con `withRequestOptions`. |
| **Sin señal no se pierde ni se repite.** | La cola offline (`core/offline/queue.ts`) notifica pendientes (`subscribePending`) y cada barrido devuelve `processed`/`dropped`; `useOfflineSync` corre al montar, al volver la red (web) y al volver la app al frente (`AppState`), y el layout lo cuenta con toasts. |
| **Nunca datos de ejemplo como si fueran reales.** | Sin `placeholderData` con mocks; mientras carga se usan `Skeleton` con la silueta de la pantalla. |
| **Errores en el idioma de la persona.** | `installZodErrorMap()` en la raíz traduce los mensajes de zod; los `DomainError` siguen mapeados en `core/errors`. Un error de carga se muestra con `ErrorState` + `retryLabel={t("common.retry")}`, nunca como lista vacía. |
| **Un solo idioma por sesión, elegido por la persona.** | El operador elige Español o Português en el menú de usuario (`useLocale`/`setLocale`, persistido); por defecto `es`. El idioma al cliente es del tenant (ADR #47). Las primitivas de `@preztiaos/ui` reciben sus textos por prop (`closeLabel`, `retryLabel`, `invalidLabel`). `tf(key, vars)` interpola `{n}`. El diccionario pt-BR cubre el 100 % de las claves (prueba `dictionary.test.ts`). |
| **Cada pantalla apilada tiene salida.** | Todas las rutas de `app/(app)/_layout.tsx` (también las modales) declaran `detail(título, ancla)` para el botón atrás con fallback en web. |

## 8. Sesión, cola offline y lista operativa del cobrador (Fase 1, ADR #51)

| Pieza | Dónde | Regla |
|---|---|---|
| **Renovación de sesión** | `core/auth/refresh.ts`, `core/auth/refresh-policy.ts`, `core/api/fetcher.ts` | Un 401 renueva UNA vez con el refresh token (mutex: varias peticiones concurrentes → un solo refresco) y reintenta la petición original con la misma `Idempotency-Key`; renovación proactiva cuando faltan < 2 min para `exp`; sin red el refresco queda "unavailable" y la sesión se conserva (la cola offline sigue). Solo un refresco rechazado (401/403) cierra sesión con motivo `expired`. `/auth/login` y `/auth/refresh` quedan fuera del interceptor. |
| **Cola offline con fallidas visibles** | `core/offline/queue.ts`, `core/offline/use-offline-operations.ts`, `features/remittances/components/offline-operations-section.tsx` | Un rechazo de negocio (4xx) NO se descarta: pasa a `failed` persistido con `reason`; la persona lo ve en "Pendientes de envío" (Mi caja) con Reintentar / Descartar (confirmado). `usePendingPaymentsByCredit()` marca en las listas del cobrador los clientes con abono pendiente o rechazado. |
| **Mis cobros de hoy** | `features/collections/api/today-queries.ts`, `features/collections/screens/collection-today-screen.tsx` (hub Clientes del cobrador e Inicio) | Todos los clientes asignados (no solo los en mora) con cuota, lo que debe hoy, saldo y estado (semáforo); búsqueda `q` con `useDebouncedValue`; botón **Cobrar** → abono; tocar la fila → detalle del cobro (bitácora, llamar). Al registrar el abono se invalidan `collectionTodayKeys.all` y las visitas. El servidor hace el resto del gesto (parada de ruta liquidada + visita). |
| **Búsqueda en servidor** | `features/accounts/api/queries.ts`, `features/borrowers/api/queries.ts#useBorrowersInfinite` | Un solo campo "nombre, cédula o teléfono" que envía `q`; filtros de estado al servidor (`status`, `onlyOverdue`); nunca filtrar las páginas ya cargadas. Los pickers muestran "Mostrando N de M". |
| **Asignación por deltas** | `features/collectors/api/queries.ts#useUpdateCollectorClients`, `assign-clients-screen.tsx` | Guardar envía solo `{ add, remove }` calculados frente a `assigned`; nunca reemplaza la cartera con lo cargado. |

## 9. Fechas, idioma y pantallas de decisión (Fase 2, ADR #52)

| Regla | Cómo se cumple |
|---|---|
| **Fechas siempre legibles.** | `formatDate` ("8 nov 2026"), `formatShortDate` ("8 nov"), `formatDateTime` ("8 nov, 14:05", con la zona horaria de la empresa cuando se conoce) de `@preztiaos/ui`. Prohibido mostrar ISO crudo o `dueDate.slice(5)`. Toda captura de fecha usa `DateField` (web: selector nativo; nativo: máscara AAAA-MM-DD + chips). |
| **Decidir viendo el cronograma.** | `useCreditQuote` + `CreditQuoteCard` en otorgar y en el modal de aprobación: cuota, total, interés, primera y última fecha, en vivo con debounce; nunca bloquea el envío. |
| **Un solo detalle por entidad.** | `/credit/:id` y `/account/:creditId` renderizan `AccountDetailScreen`; el título de ruta es "Detalle del crédito"; al llegar tras otorgar se muestra un toast con la cuota real. |
| **Nombre antes que correo.** | Donde el contrato traiga `collectorName`/`actorName`/`requesterName`/`assignedToName`/`name`, la UI muestra `nombre ?? correo`. Al crear usuarios se pide `displayName` y las zonas se eligen con casillas (`ZoneChecklist`). |
| **Idioma conmutable.** | `core/i18n` expone un store reactivo (`useLocale`, `setLocale` persistido); el selector vive en el menú de usuario; cambiar idioma también ajusta `setDefaultMoneyLocale`. El diccionario pt-BR debe cubrir el 100 % de las claves (comprobar con el diff de claves antes de mergear). |
| **Nada se pierde al cambiar de pestaña.** | `SettingsDirtyContext`: cada tab registra `isDirty`; el layout confirma antes de cambiar y avisa en web con `beforeunload`. |
| **Empezar sin adivinar.** | `OnboardingChecklist` en Inicio (ADMIN/COORDINATOR) lista los prerequisitos para operar con su acceso directo; se oculta cuando todo está completo. |
