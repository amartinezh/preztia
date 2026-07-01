# Despliegue a producción — PreztiaOS

Guía para desplegar en un **VPS Debian** con dominio propio. La configuración de producción es
**independiente** de la local: `docker-compose.yml` (solo infra, para desarrollo) **no se toca**;
todo lo de producción vive en `docker-compose.prod.yml` + `apps/api/Dockerfile` + `deploy/`.

## Arquitectura

```
Internet ──443──> Caddy ──┬─ tudominio.com / www  → landing estática (deploy/landing)
                          └─ api.tudominio.com    → API NestJS (api:3000)
        (red interna de docker) │
                                ├─ postgres:16   (sin puerto al host)
                                ├─ redis:7       (sin puerto al host)
                                └─ minio         (sin puerto al host)
```

Solo **Caddy** publica puertos (80/443) y obtiene/renueva los certificados TLS solo (Let's Encrypt).
Los servicios de datos quedan aislados en la red interna de compose.

Piezas:
- **`apps/api/Dockerfile`** — imagen multi-stage (Node 22/Debian). Construye los paquetes del
  monorepo + `apps/api` y arranca `node apps/api/dist/main.js`. Corre como usuario no-root.
- **`docker-compose.prod.yml`** — orquesta API + Postgres/Redis/MinIO + Caddy + `migrate` (one-shot).
- **`deploy/Caddyfile`** — enrutado y HTTPS.
- **`deploy/landing/`** — landing estática (HTML/CSS/JS, sin build) que consume `GET /public/news`.
- **`env.prod.example`** — plantilla de variables; se copia a `.env.prod` (gitignored).

---

## 1. Requisitos en el VPS

```bash
# Docker Engine + plugin compose (oficial)
curl -fsSL https://get.docker.com | sh
docker compose version    # verifica que exista el subcomando compose
```

Abre el firewall a 80 y 443 (p. ej. `ufw allow 80,443/tcp`).

## 2. DNS

Crea tres registros **A** apuntando a la IP pública del VPS:

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | `@`   | IP del VPS |
| A | `www` | IP del VPS |
| A | `api` | IP del VPS |

Espera a que propague antes de levantar Caddy (necesita resolver los hosts para emitir TLS).

## 3. Traer el código y configurar

```bash
git clone <tu-repo> preztia && cd preztia
cp env.prod.example .env.prod
```

Edita **`.env.prod`** y rellena, como mínimo:
- `DOMAIN` y `ACME_EMAIL`.
- `POSTGRES_PASSWORD` (y el mismo valor dentro de `DATABASE_URL`).
- `JWT_SECRET`, `KYC_ENCRYPTION_KEY` → `openssl rand -base64 32`.
- `MINIO_ROOT_PASSWORD` = `MINIO_SECRET_KEY` (deben coincidir).
- `CORS_ORIGIN` con tu dominio (`https://tudominio.com,https://www.tudominio.com`).

> Los roles de BD `app` y `platform` los crea `docker/initdb/01-init.sql` en el primer arranque
> con sus passwords (`app`/`platform`); solo son alcanzables por la red interna. Si los cambias,
> edita también ese SQL. El `.env.prod` es leído por **todos** los servicios (`env_file`).

## 4. Construir, migrar y levantar

```bash
# 1) Construye la imagen de la API
docker compose -f docker-compose.prod.yml build

# 2) Aplica las migraciones de esquema (one-shot; crea tablas, RLS, IAM, pagos, etc.)
docker compose -f docker-compose.prod.yml --profile migrate up migrate

# 3) Levanta todo el stack
docker compose -f docker-compose.prod.yml up -d

# 4) (Primera vez) crea un usuario para iniciar sesión en la app
docker compose -f docker-compose.prod.yml exec api pnpm --filter api seed:user
```

Verifica:
```bash
docker compose -f docker-compose.prod.yml ps          # todos healthy/up
docker compose -f docker-compose.prod.yml logs -f api  # arranque de NestJS
```

- Landing: `https://tudominio.com` → carga y muestra las tarjetas del **pulso del sector**.
- API:     `https://api.tudominio.com/public/news` → JSON con `sector` + `platform`.

## 5. Operación

```bash
# Actualizar tras un git pull
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml --profile migrate up migrate   # si hay migraciones nuevas
docker compose -f docker-compose.prod.yml up -d

# Logs / reinicio / parar
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down          # (sin -v: conserva los datos)
```

Backup rápido de Postgres:
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```

## 6. La landing y el "pulso del sector"

- La landing es **estática** (`deploy/landing/`), servida por Caddy. Para editar textos/estilos,
  cambia los archivos y `docker compose -f docker-compose.prod.yml restart caddy` (o recarga; el
  volumen es de solo lectura).
- El feed lo sirve el API en `GET /public/news` (módulo `apps/api/src/news`): un **cron diario**
  agrega titulares de fuentes RSS/Atom y los mezcla con el **changelog propio** (editable en
  `apps/api/src/news/platform-changelog.ts`). Es resiliente: si un feed cae, conserva el último
  snapshot bueno.
- Fuentes configurables con `NEWS_FEEDS` en `.env.prod` (formato `Etiqueta|url` separadas por `;`).
  Vacío → feeds por defecto (Brasil). Hora del refresco: `NEWS_REFRESH_CRON` (por defecto `0 6 * * *`).

## Notas de seguridad
- Ningún servicio de datos expone puertos al host: solo Caddy. El aislamiento entre empresas lo
  garantiza además RLS en Postgres.
- El endpoint `/public/news` es público a propósito (no lleva `JwtGuard`), no consulta la BD ni
  maneja PII: solo devuelve un snapshot en memoria.
- Cambia **todos** los secretos por defecto antes de exponer el servidor.

## Fuera de alcance (siguiente iteración)
- Export estático de la app Expo-web servido en `app.tudominio.com`.
- Exponer MinIO vía `cdn.tudominio.com` para URLs prefirmadas del cliente.
- Backups automatizados y panel de observabilidad.
