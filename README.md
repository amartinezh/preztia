# PreztiaOS

Plataforma **multi-tenant** de **préstamos y cobranza** (microcrédito de ruta / gota a gota)
con **onboarding y cobranza por WhatsApp asistidos por IA**. El recorrido real: un solicitante
escribe por WhatsApp → un asistente (Gemini) lo atiende y abre una **solicitud de crédito** →
recolecta los **documentos KYC** y corre un **antifraude documental** (reglas locales + fuentes
oficiales brasileñas) → se **otorga el crédito** con su calendario de cuotas → el deudor **paga
por PIX** (o en efectivo) y el sistema **verifica, abona y concilia**. Todo movimiento de dinero
queda en bitácora **append-only**, y el aislamiento entre empresas lo garantiza PostgreSQL con
**Row-Level Security**.

> Monorepo **pnpm + Turborepo**, scope `@preztiaos/*`. Backend **NestJS** (hexagonal/DDD),
> contrato único **ts-rest + zod**, cliente **Expo** (iOS / Android / Web) con un design system propio.

---

## ✨ Pilares

- **Aislamiento fuerte entre tenants** — RLS `FORCE` + rol de aplicación sin bypass.
- **Tipado de punta a punta** — un solo paquete de contratos (`@preztiaos/contracts`) para API y clientes.
- **Dominio rico y testeable** — dinero (centavos enteros), cuotas y antifraude como lógica pura, sin framework ni I/O.
- **Seguridad y dinero** — JWT, idempotencia en operaciones de dinero, auditoría append-only.

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| Backend | NestJS 11, Drizzle ORM, PostgreSQL 16 (`ltree`, RLS), Redis, MinIO |
| Contrato | ts-rest + zod (`@preztiaos/contracts`) |
| Cliente | Expo SDK 56 + Expo Router + NativeWind + React Query (`apps/mobile`) |
| Tooling | pnpm 9, Turborepo, TypeScript, Vitest/Jest |

## 📁 Estructura

```
apps/
  api/        # NestJS (HTTP, repos Drizzle, tenancy/RLS)
  mobile/     # Expo — iOS / Android / Web (un solo código)
packages/
  contracts/  # ts-rest + zod (fuente única de tipos del API)
  domain/     # lógica pura (Money, cuotas, antifraude)
  application/# casos de uso + puertos
  db/         # esquema Drizzle + migraciones
  ui/         # @preztiaos/ui — design system
  config/     # tsconfig/eslint base
docs/         # ARCHITECTURE.md · DESIGN.md · FRONTEND_ARCHITECTURE.md
test/         # colección Postman E2E del API
```

---

## ✅ Requisitos previos

- **Node ≥ 20** (recomendado **22**, ver `.nvmrc`)
- **pnpm 9** — `corepack enable && corepack prepare pnpm@9 --activate`
- **Docker** (para PostgreSQL, Redis y MinIO)

---

## 🚀 Levantar el proyecto (paso a paso)

Desde la raíz del repo:

```bash
# 1) Dependencias
pnpm install

# 2) Configuración: copia el ejemplo y pon un valor real en JWT_SECRET
cp .env.example .env
#   edita .env y cambia JWT_SECRET=... por un secreto real

# 3) Infraestructura (Postgres + Redis + MinIO) en Docker
pnpm db:up

# 4) Compila los paquetes (genera dist/, necesario ANTES de la API)
pnpm build

# 5) Aplica las migraciones (crea el esquema, RLS, tablas IAM/pagos)
pnpm db:migrate

# 6) Crea un usuario para poder iniciar sesión
pnpm --filter api seed:user
#   imprime el email/contraseña y el tenantId; guárdalos
```

Luego, en **dos terminales**:

```bash
# Terminal A — API (http://localhost:3000)
pnpm --filter api start

# Terminal B — App (Web / iOS / Android)
pnpm --filter @preztiaos/mobile web        # navegador (abre la URL que muestra la terminal)
# pnpm --filter @preztiaos/mobile ios       # simulador iOS
# pnpm --filter @preztiaos/mobile android   # emulador Android
```

> **Nota de puertos:** la API corre en **3000**; la app web abre su propia URL (Metro). En el
> emulador de Android el host de la API es `10.0.2.2:3000`; en dispositivo físico define
> `EXPO_PUBLIC_API_URL` con la IP LAN de tu máquina.

---

## 👀 Verlo funcionando

1. Abre la **app web** → verás la pantalla de **inicio de sesión**.
2. Entra con el usuario sembrado en el paso 6 (`SEED_EMAIL` / `SEED_PASSWORD`, por defecto
   `admin@preztia.test` / `changeme-123`).
3. Ya dentro: lista de **créditos**, otorgar un crédito, ver su **cartera** y **registrar un abono**.

¿Prefieres probar solo el **API**? Importa la colección Postman:

- Archivo: [`test/preztiaos.postman_collection.json`](test/preztiaos.postman_collection.json)
- Ejecuta en orden: **05 · Autenticación** (login) → **06 · Créditos** → **07 · Pagos**.
  El login guarda el token y el resto de peticiones lo usan automáticamente.

Consolas útiles de la infraestructura:

- **MinIO** → http://localhost:9001 (objetos KYC)
- **PostgreSQL** → `localhost:5432` · **Redis** → `localhost:6379`

---

## 🛠️ Comandos útiles

```bash
pnpm build        # build topológico (cacheado)
pnpm typecheck    # typecheck de todo el monorepo
pnpm test         # pruebas (dominio, aplicación, ui, mobile, api)
pnpm lint         # lint de todo el monorepo
pnpm dev          # watchers de TypeScript de los paquetes (recompilan dist/ al guardar)
pnpm db:up        # levanta Postgres + Redis + MinIO
pnpm db:down      # baja la infraestructura
pnpm db:generate  # genera una migración a partir del esquema Drizzle
pnpm db:migrate   # aplica las migraciones pendientes
```

> Para desarrollo continuo, deja `pnpm dev` corriendo (recompila los paquetes) junto con
> `pnpm --filter api start:dev` (API en watch).

---

## 📚 Documentación

- [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) — *el cómo*: principios, capas (hexagonal/DDD), RLS, contract-first, CI, ADRs.
- [**docs/DESIGN.md**](docs/DESIGN.md) — *el qué*: bounded contexts y su estado, modelo de datos, máquinas de estado, flujos (validado contra el código).
- [**docs/FRONTEND_ARCHITECTURE.md**](docs/FRONTEND_ARCHITECTURE.md) — arquitectura del cliente Expo.
- [**docs/analisisPlataformas.md**](docs/analisisPlataformas.md) — *deep-dive* del antifraude documental.

---

## 🔧 Solución de problemas

- **La API no resuelve `@preztiaos/*`** → corre `pnpm build` antes de arrancarla (consume `dist/`).
- **`JWT_SECRET no configurado`** al hacer login → define `JWT_SECRET` en `.env`.
- **No puedo iniciar sesión** → corre `pnpm --filter api seed:user` y usa esas credenciales.
- **Cambié `node-linker` o el lockfile** → borra todos los `node_modules` y reinstala (requisito de Metro/Expo).
