# CLAUDE.md — PreztiaOS

Guía para generar y modificar código en este repositorio. La **fuente única de verdad** de la arquitectura es [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); este archivo resume lo que **siempre** debe respetarse al escribir código.

PreztiaOS es una plataforma **multi-tenant** de préstamos y cobranza (gota a gota / cobranza por zonas). Monorepo **pnpm + Turborepo**, scope `@preztiaos/*`.

---

## Atributos de calidad (regla vinculante)

Todo algoritmo, caso de uso o módulo que generes **debe** cumplir estos cuatro atributos y demostrar que es **correcto**. No son opcionales: son criterios de aceptación. Detalle completo en [§3 del documento de arquitectura](docs/ARCHITECTURE.md#3-atributos-de-calidad-y-estándares-de-código).

1. **Responsabilidad única (SRP).** Cada unidad tiene una sola razón para cambiar.
   - **Controller** → valida la frontera HTTP (zod) y delega; no contiene reglas ni SQL.
   - **Caso de uso (`*Handler`)** → orquesta dominio + puertos y define la transacción; no valida HTTP, no arma SQL, no calcula reglas.
   - **Dominio (`Money`, `buildSchedule`)** → reglas puras e invariantes; no conoce I/O, NestJS, Drizzle ni HTTP.
   - **Repositorio (`*Repository`)** → traduce dominio ↔ persistencia; no contiene reglas de negocio.
   - 🚨 Alarma: nombres con "y"/`Manager`/`Util` genéricos, funciones >~40 líneas, una clase que importa de capas distintas.
2. **Código limpio.** Nombres reveladores de intención; funciones pequeñas de un solo nivel de abstracción; sin números mágicos (constantes con nombre); sin duplicación (DRY, reuso vía `packages/*`); errores explícitos (`DomainError`, nunca `catch` vacío); inmutabilidad por defecto.
3. **Código entendible.** Se lee como narración del caso de uso; comentarios explican el *porqué*, no el *qué*; tipos explícitos en fronteras públicas, evitar `any`; un *slice* nuevo replica la estructura del de crédito.
4. **Código mantenible.** Bajo acoplamiento / alta cohesión vía inversión de dependencias; dependencias solo "hacia abajo" (apps → packages, application → domain); todo cambio de comportamiento se cubre con prueba; configuración fuera del código (`.env`).

### Definición de "correcto" (corrección verificable)

Un algoritmo es correcto solo si se **demuestra**, no se asume:
- **Invariantes explícitos** (ej.: `Σ amountDueMinor === total.amountMinor`).
- **Pruebas** que verifican cada invariante y caso borde (cero, redondeo, monedas distintas, límites).
- **Fallo rápido** ante entradas inválidas (`DomainError`); sin estados silenciosamente incorrectos.
- **Verde en CI**: typecheck + lint + test + build pasan.

### Checklist antes de marcar algo como "listo"

- [ ] Arrancó por **spec (Gherkin) → prueba de dominio → implementación**.
- [ ] Respeta el **SRP**; no cruza límites de capa.
- [ ] Reglas de negocio en **dominio puro**, sin I/O ni framework.
- [ ] Entrada **validada en la frontera** (zod del contrato); el dominio asume datos válidos.
- [ ] **Invariantes** enunciados y cubiertos por **pruebas**.
- [ ] **Dinero en unidades menores** (entero), sin coma flotante.
- [ ] Respeta **multitenancy**: toda escritura por `withTenantTx`; toda tabla de negocio lleva `tenant_id`.
- [ ] Sin números mágicos ni duplicación; errores explícitos; nombres reveladores.
- [ ] Pasa **typecheck + lint + test + build**.

---

## Reglas de arquitectura (no romper)

- **Hexagonal / DDD.** El dominio y la aplicación no conocen NestJS, Drizzle ni HTTP. La infraestructura implementa puertos definidos por la aplicación.
- **Contract-first.** `@preztiaos/contracts` (ts-rest + zod) es la fuente única de tipos del API; servidor y clientes derivan de ahí. La validación de entrada vive en el contrato.
- **Multitenancy con RLS.** Aislamiento garantizado por PostgreSQL (RLS `FORCE` + rol `app` `NOBYPASSRLS`). Toda escritura va por `withTenantTx`; nunca confiar solo en que el código "recuerde" filtrar.
- **Dependencias solo hacia abajo:** `domain → config`; `application → domain, config`; `contracts/db → config`; `api → application, contracts, db`; `mobile → contracts`.

## Convenciones

- **Scope:** `@preztiaos/*` (con "os"). Erratas que rompen el workspace: `prestiaos`, `@preztia`, `cobranza(os)`.
- **`node-linker=hoisted`** obligatorio (Metro/Expo). Al cambiarlo, borrar todos los `node_modules` y reinstalar.
- **Build antes que la API:** `apps/api` consume `dist/` de los paquetes → `pnpm build` (topológico, cacheado) debe correr antes.
- **Dinero:** siempre unidades menores (centavos) como entero (`*_minor`).
- **Identificadores:** `uuid` (`gen_random_uuid()` / `randomUUID()`).
- **Fechas:** `timestamptz` para auditoría; `date` para fechas de negocio.
- **Imports de Node:** explícitos (`node:crypto`).
- **Idioma:** dominio y comentarios en español; identificadores de código en inglés.

## Comandos

```bash
pnpm build       # turbo run build (topológico, cacheado) — necesario antes de la API
pnpm dev         # api + web + watchers en paralelo
pnpm typecheck
pnpm test
pnpm db:up       # docker compose up -d (pg + redis + minio)
pnpm db:migrate  # drizzle-kit migrate
pnpm db:down
```

---

> Al tomar una decisión de arquitectura relevante, actualiza [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (ADR + diagramas) y, si aplica, este archivo.
