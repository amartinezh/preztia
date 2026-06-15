# PreztiaOS — Arquitectura Frontend (Expo iOS/Android/Web)

> **Estado:** documento vivo. Complementa [ARCHITECTURE.md](ARCHITECTURE.md) (fuente de verdad del sistema).
> **Ámbito:** la app cliente `apps/mobile` (Expo SDK 56 + Expo Router + NativeWind v4) y el design system `@preztiaos/ui`.
> **Última actualización:** 2026-06-14 (IAM por roles en el cliente: slices `tenants/users/zones/collectors/clients`, menú role-aware en `(tabs)/_layout.tsx`, primitivos `Select`/`Switch`).

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
