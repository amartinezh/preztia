# Instalación en producción — servidor Debian desde cero

> **Última actualización:** 2026-07-09.
>
> Guía completa para preparar un **VPS Debian 12 (bookworm) recién creado** —desde el primer
> acceso por SSH hasta tener PreztiaOS corriendo con HTTPS— incluyendo la instalación de Docker.
> Para el día a día una vez desplegado (actualizar tras un `git pull`, logs, reinicios), usa
> **[DEPLOYMENT.md](./DEPLOYMENT.md)**, que asume que ya completaste esta guía. Debian 11
> (bullseye) también funciona; se eligió 12 porque es la misma base de `apps/api/Dockerfile`
> (`node:22-bookworm-slim`).

## 0. Qué necesitas antes de empezar

- Un VPS **Debian 12** limpio.
  - Mínimo recomendado: **2 vCPU / 4 GB RAM / 40 GB disco**. Con menos de 4 GB crea swap (paso 5)
    para que no falle el build de la imagen dentro del VPS.
- Acceso **root** por SSH (contraseña o llave que te dio tu proveedor).
- Un **dominio propio** con acceso a su panel de DNS.
- Tu **llave pública SSH** local (p. ej. `~/.ssh/id_ed25519.pub`) si vas a endurecer el acceso
  (paso 2.1, recomendado).

Arquitectura que vas a levantar (detalle completo en [DEPLOYMENT.md](./DEPLOYMENT.md)):

```
Internet ──443──> Caddy ──┬─ tudominio.com / www  → landing estática (deploy/landing)
                          └─ api.tudominio.com    → API NestJS (api:3000)
        (red interna docker) │
                                ├─ postgres:16   (sin puerto al host)
                                ├─ redis:7       (sin puerto al host)
                                └─ minio         (sin puerto al host)
```

Solo **Caddy** publica puertos (80/443); Postgres/Redis/MinIO quedan aislados en la red interna
de compose — por eso el firewall del paso 3 solo necesita abrir SSH, 80 y 443.

---

## 1. Primer acceso y actualización del sistema

```bash
ssh root@IP_DEL_VPS
apt update && apt full-upgrade -y
apt install -y curl ca-certificates gnupg sudo ufw git
reboot   # solo si se actualizó el kernel
```

## 2. Usuario no-root para operar el servidor

Nunca operes a diario como `root`.

```bash
adduser deploy        # pide una contraseña; usa una fuerte
usermod -aG sudo deploy
```

### 2.1 (Recomendado) acceso por llave SSH y cierre de la contraseña

Desde tu máquina local:

```bash
ssh-copy-id deploy@IP_DEL_VPS
```

Verifica que puedes entrar como `deploy` con la llave **en una terminal nueva, sin cerrar la
sesión root actual**. Solo entonces, en el servidor:

```bash
sudo sed -i \
  -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#\?PermitRootLogin.*/PermitRootLogin no/' \
  /etc/ssh/sshd_config
sudo systemctl restart ssh
```

> Confirma que **sigues pudiendo entrar** (`ssh deploy@IP_DEL_VPS`) antes de cerrar la sesión
> root de este paso. Si algo falla, usa la consola del proveedor (VNC/serial) para revertir
> `/etc/ssh/sshd_config`.

De aquí en adelante todos los comandos son como `deploy` (con `sudo` cuando haga falta).

## 3. Firewall (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable      # confirma con "y"
sudo ufw status
```

## 4. Zona horaria (opcional, ayuda a leer logs y backups)

```bash
sudo timedatectl set-timezone America/Bogota   # o la que corresponda
```

## 5. Swap (solo si el VPS tiene menos de 4 GB de RAM)

`apps/api/Dockerfile` compila varios paquetes del monorepo (`pnpm --filter "api..." run build`)
dentro del build de la imagen; en VPS pequeños esto puede agotar la memoria y matar el build.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## 6. Instalar Docker Engine + plugin compose

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy
```

Cierra la sesión SSH y vuelve a entrar (para que el grupo `docker` tome efecto), luego verifica:

```bash
docker --version
docker compose version             # confirma que existe el subcomando "compose"
sudo systemctl is-enabled docker   # debe decir "enabled" (arranca solo al reiniciar el VPS)
```

> Añadir tu usuario al grupo `docker` le da privilegios equivalentes a `root` (puede montar
> cualquier ruta del host vía un contenedor). Es el trade-off estándar para no usar `sudo` en cada
> `docker compose`; si prefieres evitarlo, antepone `sudo` a los comandos del resto de la guía.

### 6.1 Rotación de logs de Docker

Por defecto Docker no rota los logs de los contenedores. Con `restart: unless-stopped` corriendo
indefinidamente (todo el stack de `docker-compose.prod.yml`), el driver `json-file` puede llenar
el disco con el tiempo. Configúralo una sola vez, antes de levantar el stack:

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

## 7. DNS

Crea tres registros **A** apuntando a la IP pública del VPS, y espera a que propaguen antes del
paso 10 (Caddy necesita resolver los hosts para emitir el certificado TLS):

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | `@`   | IP del VPS |
| A | `www` | IP del VPS |
| A | `api` | IP del VPS |

Verifica con `dig +short tudominio.com` y `dig +short api.tudominio.com` desde tu máquina.

## 8. Clonar el repositorio

```bash
cd ~
git clone <url-de-tu-repo> preztia
cd preztia
cp env.prod.example .env.prod
chmod 600 .env.prod   # contiene secretos: solo tu usuario puede leerlo
```

## 9. Configurar `.env.prod`

Edita `.env.prod` (`nano .env.prod`). Como mínimo, rellena:

| Variable | Cómo obtenerla |
|---|---|
| `DOMAIN`, `ACME_EMAIL` | tu dominio y un correo real (Let's Encrypt lo usa para avisos de renovación) |
| `POSTGRES_PASSWORD` | genera un secreto fuerte y cópialo también dentro de `DATABASE_URL` |
| `JWT_SECRET` | obligatorio: firma los tokens de sesión |
| `KYC_ENCRYPTION_KEY` | obligatorio: cifra en reposo los documentos KYC en MinIO |
| `MINIO_ROOT_PASSWORD` **=** `MINIO_SECRET_KEY` | mismo valor en ambas (la API se autentica contra MinIO con esas credenciales) |
| `CORS_ORIGIN` | `https://tudominio.com,https://www.tudominio.com` |

Genera los tres secretos de una sola vez:

```bash
openssl rand -base64 32   # → POSTGRES_PASSWORD (pégalo también en DATABASE_URL)
openssl rand -base64 32   # → JWT_SECRET
openssl rand -base64 32   # → KYC_ENCRYPTION_KEY
```

Los bloques `WHATSAPP_*`, `GEMINI_*`, `SERPRO_*`, `INTER_*` puedes dejarlos con sus valores de
ejemplo si todavía no vas a activar esos canales: no impiden que la API arranque, actívalos
cuando integres cada proveedor.

> **Los roles de BD `app` y `platform`** los crea `docker/initdb/01-init.sql` **solo la primera
> vez** que arranca el volumen de Postgres (contenedor con datos vacíos). Si vas a cambiar sus
> contraseñas por defecto (`app`/`platform`), edita ese SQL **antes** del primer `up` del paso 10
> y refleja el mismo password en `APP_DATABASE_URL` / `PLATFORM_DATABASE_URL`. Si el volumen ya
> arrancó una vez, editar el SQL después no tiene efecto — tocaría cambiar el rol a mano
> (`ALTER ROLE ... PASSWORD ...` por `psql`).

## 10. Construir, migrar y levantar

```bash
# 1) Construye la imagen de la API (multi-stage, apps/api/Dockerfile)
docker compose -f docker-compose.prod.yml build

# 2) Aplica el esquema (one-shot: tablas, RLS, IAM, pagos…)
docker compose -f docker-compose.prod.yml --profile migrate up migrate

# 3) Levanta API + Postgres + Redis + MinIO + Caddy
docker compose -f docker-compose.prod.yml up -d

# 4) Primer usuario para iniciar sesión (imprime email/contraseña/tenantId: guárdalos)
docker compose -f docker-compose.prod.yml exec api pnpm --filter api seed:user
```

## 11. Verificación

```bash
docker compose -f docker-compose.prod.yml ps            # todo healthy/Up
docker compose -f docker-compose.prod.yml logs -f api    # arranque de NestJS sin errores
```

- `https://tudominio.com` → landing con el "pulso del sector".
- `https://api.tudominio.com/public/news` → JSON (`sector` + `platform`).
- Certificado TLS válido en ambos (candado del navegador) — Caddy lo emite solo al primer
  arranque; si falla, confirma que el DNS ya propagó (paso 7) y revisa
  `docker compose -f docker-compose.prod.yml logs caddy`.
- Inicia sesión en el cliente con las credenciales del paso 10.4.

## 12. Arranque automático tras reiniciar el VPS

`restart: unless-stopped` en `docker-compose.prod.yml` hace que **Docker** reinicie los
contenedores si el *daemon* se reinicia; falta que el daemon mismo arranque al bootear el
servidor (normalmente ya queda así tras el paso 6 — confírmalo):

```bash
sudo systemctl enable docker
```

Prueba real (los datos son persistentes en volúmenes, no hay riesgo):

```bash
sudo reboot
# tras reconectar:
docker compose -f ~/preztia/docker-compose.prod.yml ps
```

## 13. Backups de Postgres

Automatizarlos está fuera de alcance del repo por ahora (ver "Fuera de alcance" en
[DEPLOYMENT.md](./DEPLOYMENT.md)). Mientras tanto, un cron simple con retención de 14 días:

```bash
mkdir -p ~/backups
cat > ~/backup-preztia.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd ~/preztia
set -a; source .env.prod; set +a
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > ~/backups/preztia-$(date +%F).sql.gz
find ~/backups -name '*.sql.gz' -mtime +14 -delete
EOF
chmod +x ~/backup-preztia.sh
```

```bash
crontab -e
# añade:
0 3 * * * /home/deploy/backup-preztia.sh >> /home/deploy/backup-preztia.log 2>&1
```

Copia los `.sql.gz` fuera del VPS periódicamente (S3, otro servidor, etc.) — una sola copia en el
mismo disco no es un backup. Prueba al menos una vez que un `.sql.gz` restaura correctamente en
un Postgres de prueba.

## 14. Día a día

Para actualizar tras un `git pull`, ver logs, reiniciar servicios o hacer un backup manual, sigue
la sección **"5. Operación"** de [DEPLOYMENT.md](./DEPLOYMENT.md) — ya asume que completaste esta
guía.

## 15. Checklist de seguridad antes de anunciar el servidor

- [ ] `PasswordAuthentication no` y `PermitRootLogin no` en `sshd_config` (paso 2.1), o al menos
      contraseñas fuertes si no pudiste usar llaves.
- [ ] `ufw` activo con solo SSH/80/443 abiertos (paso 3).
- [ ] Todos los secretos de `.env.prod` cambiados — ningún `CAMBIA_ESTE_SECRETO_*` ni
      `cambia-esto` de la plantilla debe quedar en producción.
- [ ] `.env.prod` con permisos `600` y fuera de git (el `.gitignore` raíz ya lo excluye).
- [ ] Cron de backups activo y su restauración probada al menos una vez.
- [ ] `docker compose ps` con todos los servicios `healthy`/`Up` y logs de `api`/`caddy` sin
      errores.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Caddy no emite el certificado TLS | DNS aún no propagó, o 80/443 bloqueados | `dig` el dominio; revisa `sudo ufw status`; `docker compose -f docker-compose.prod.yml logs caddy` |
| `api` se reinicia en bucle | Falta una variable obligatoria en `.env.prod` (`JWT_SECRET`, `KYC_ENCRYPTION_KEY`, `DATABASE_URL`) | `docker compose -f docker-compose.prod.yml logs api` |
| `migrate` falla por conexión rechazada | Postgres no llegó a `healthy` a tiempo en el primer arranque | reintenta: `docker compose -f docker-compose.prod.yml --profile migrate up migrate` |
| Se llenó el disco con el tiempo | Logs de Docker sin rotar | confirma `/etc/docker/daemon.json` (paso 6.1); revisa con `docker system df` antes de un `docker system prune` |
| El build de la imagen muere sin mensaje claro (`Killed`) | VPS sin memoria suficiente | agrega swap (paso 5) o sube el plan del VPS |
