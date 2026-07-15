# syntax=docker/dockerfile:1
#
# Imagen de PRODUCCIÓN de la API (NestJS). Multi-stage:
#   builder → instala el subárbol de la API y compila los paquetes + apps/api (dist/).
#   runner  → copia el workspace ya construido y arranca `node apps/api/dist/main.js`.
#
# Base Debian (bookworm) para casar con el VPS de despliegue y con .nvmrc (Node 22).
# El contexto de build es la RAÍZ del monorepo (ver docker-compose.prod.yml → build.context: .).

##############################  Base común  ##############################
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
# corepack activa pnpm 9 (fijado por packageManager en package.json). node-linker=hoisted lo
# aporta el .npmrc del repo (obligatorio para el monorepo).
RUN corepack enable
WORKDIR /app

##############################  Builder  ##############################
FROM base AS builder

# 1) Solo manifiestos primero: maximiza el cacheo de la instalación (no se reinstala si el
#    código cambia pero los package.json no).
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY packages/config/package.json      packages/config/package.json
COPY packages/domain/package.json      packages/domain/package.json
COPY packages/contracts/package.json   packages/contracts/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/db/package.json          packages/db/package.json
COPY packages/ui/package.json          packages/ui/package.json
COPY apps/api/package.json             apps/api/package.json
COPY apps/mobile/package.json          apps/mobile/package.json

# 2) Instala SOLO el subárbol de la API (`api...` = api + sus dependencias de workspace, incluida
#    @preztiaos/db para migrar). Excluye Expo/mobile: build más rápido y liviano.
RUN pnpm install --frozen-lockfile --filter "api..."

# 3) Código y build topológico (config → domain → contracts → db → application → api).
COPY . .
RUN pnpm --filter "api..." run build

##############################  Runner  ##############################
FROM base AS runner
ENV NODE_ENV=production
# El workspace ya construido (incluye drizzle-kit para el servicio `migrate`, que reutiliza esta
# misma imagen). Los secretos y hosts llegan por entorno desde docker-compose (env_file).
COPY --from=builder /app /app

# Ejecuta como usuario sin privilegios (la imagen node trae el usuario `node`).
USER node
EXPOSE 3010

# Healthcheck sin binarios extra: GET / responde "Hello World!" (200).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3010)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
