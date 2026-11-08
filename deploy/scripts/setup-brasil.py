#!/usr/bin/env python3
"""
Deja la empresa principal lista para operar con UNA sola ruta de cobro en Brasil.

Se ejecuta EN EL SERVIDOR (necesita docker para el respaldo y para mover los canales de
mensajería a la zona nueva; todo lo demás va por la API pública, respetando las reglas del
dominio). Solo biblioteca estándar de Python 3.

Qué hace, en orden (cada paso es idempotente: se puede volver a correr):
  1. Respaldo de la base de datos en ~/backups/preztia-pre-brasil-<fecha>.sql.gz.
  2. Inicia sesión como SUPER_ADMIN y crea (o reactiva) un ADMIN temporal del tenant para hacer
     la configuración sin tocar la contraseña del administrador real. Al final lo desactiva.
  3. PURGA los datos de prueba del tenant (clientes, créditos, pagos, cajas, conversaciones…).
     Conserva usuarios, zonas, canales de WhatsApp/Telegram, cuentas bancarias y configuración.
  4. Crea la zona raíz "Brasil" (si no existe) y mueve a ella los canales de WhatsApp y Telegram.
  5. Crea (o reactiva) coordinador1, cobrador1 y cobrador2 con alcance en esa zona, vincula al
     coordinador y DESACTIVA a todos los demás coordinadores y cobradores.
  6. Elimina las zonas sobrantes (hojas primero).
  7. Conserva UNA cuenta bancaria (por defecto la que contiene "PicPay" en su nombre) y elimina
     las de demostración.
  8. Crea las cajas: una de oficina, una bancaria ligada a la cuenta conservada y la caja de
     ruta de cada cobrador (sin caja de ruta el cobrador no puede recibir efectivo).
  9. Fija idioma de atención pt-BR, zona horaria America/Sao_Paulo y canales habilitados.

Uso (en ~/preztia del servidor):
  SUPER_EMAIL=super@... SUPER_PASSWORD='...' python3 deploy/scripts/setup-brasil.py          # solo muestra el plan
  SUPER_EMAIL=super@... SUPER_PASSWORD='...' CONFIRM=SI python3 deploy/scripts/setup-brasil.py  # ejecuta

Variables opcionales: API_URL (https://api.preztia.co), TENANT_ID, ZONE_NAME (Brasil), BACKUP_DIR,
COMPOSE_FILE_NAME / ENV_FILE_NAME (para ensayar en local: docker-compose.yml / .env),
USERS_DOMAIN (preztia.co), KEEP_BANK_ACCOUNT (PicPay), OFFICE_BOX_NAME, PURGE_PASSWORD (si no
se da, se lee PLATFORM_PURGE_PASSWORD de .env.prod), COORD_PASSWORD / COB1_PASSWORD /
COB2_PASSWORD (si no se dan, se generan y se imprimen UNA sola vez al final).
"""
from __future__ import annotations

import json
import os
import secrets
import string
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[2]
# En producción: docker-compose.prod.yml + .env.prod. Para ensayar en local: COMPOSE_FILE_NAME=docker-compose.yml ENV_FILE_NAME=.env
ENV_FILE = REPO_DIR / os.environ.get("ENV_FILE_NAME", ".env.prod")
COMPOSE = ["docker", "compose", "-f", str(REPO_DIR / os.environ.get("COMPOSE_FILE_NAME", "docker-compose.prod.yml"))]
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", str(Path.home() / "backups")))

API_URL = os.environ.get("API_URL", "https://api.preztia.co").rstrip("/")
TENANT_ID = os.environ.get("TENANT_ID", "00000000-0000-0000-0000-000000000001")
ZONE_NAME = os.environ.get("ZONE_NAME", "Brasil")
USERS_DOMAIN = os.environ.get("USERS_DOMAIN", "preztia.co")
KEEP_BANK_ACCOUNT = os.environ.get("KEEP_BANK_ACCOUNT", "PicPay").lower()
OFFICE_BOX_NAME = os.environ.get("OFFICE_BOX_NAME", "Caja Brasil")
CONFIRM = os.environ.get("CONFIRM") == "SI"

TEMP_ADMIN_EMAIL = f"setup-brasil@{USERS_DOMAIN}"
TEAM = [
    ("coordinador1", "COORDINATOR", "COORD_PASSWORD"),
    ("cobrador1", "COLLECTOR", "COB1_PASSWORD"),
    ("cobrador2", "COLLECTOR", "COB2_PASSWORD"),
]
TIME_ZONE = "America/Sao_Paulo"
CLIENT_LANGUAGE = "pt-BR"


def log(msg: str) -> None:
    print(msg, flush=True)


def fail(msg: str) -> None:
    print(f"✖ {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def env_value(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def gen_password() -> str:
    alphabet = string.ascii_letters + string.digits
    body = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"Pz-{body}"


class Api:
    """Cliente mínimo de la API: JSON, Bearer y x-tenant-id; errores legibles."""

    def __init__(self, token: str | None = None, tenant_id: str | None = None):
        self.token = token
        self.tenant_id = tenant_id

    def call(self, method: str, path: str, body: dict | None = None, ok=(200, 201, 204)):
        headers = {"content-type": "application/json", "accept": "application/json"}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        if self.tenant_id:
            headers["x-tenant-id"] = self.tenant_id
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{API_URL}{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                status = res.status
        except urllib.error.HTTPError as e:
            raw = e.read()
            status = e.code
        payload = json.loads(raw) if raw else {}
        if status not in ok:
            raise RuntimeError(f"{method} {path} → HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:400]}")
        return payload

    def login(self, email: str, password: str) -> "Api":
        tokens = self.call("POST", "/auth/login", {"email": email, "password": password})
        return Api(tokens["accessToken"], None)


def list_all(client: "Api", path: str) -> list[dict]:
    """Recorre todas las páginas de un listado paginado del contrato (pageSize máx. 100)."""
    items: list[dict] = []
    page = 1
    while True:
        res = client.call("GET", f"{path}?page={page}&pageSize=100")
        items.extend(res.get("items", []))
        if page * res.get("pageSize", 100) >= res.get("total", 0):
            return items
        page += 1


def psql(sql: str) -> str:
    """SQL contra la base (rol dueño: salta RLS). Solo para lo que la API no expone."""
    # -q: sin etiquetas de comando ("UPDATE 3") para que la salida sea solo el resultado del SELECT.
    cmd = COMPOSE + ["exec", "-T", "postgres", "sh", "-c",
                     'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F"|"']
    res = subprocess.run(cmd, input=sql, text=True, capture_output=True, cwd=REPO_DIR)
    if res.returncode != 0:
        raise RuntimeError(f"psql: {res.stderr.strip()}")
    return res.stdout.strip()


def backup() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = BACKUP_DIR / f"preztia-pre-brasil-{stamp}.sql.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = COMPOSE + ["exec", "-T", "postgres", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip -c']
    with out.open("wb") as fh:
        res = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, cwd=REPO_DIR)
    if res.returncode != 0 or out.stat().st_size < 10_000:
        fail(f"respaldo fallido: {res.stderr.decode()[:300]}")
    return out


def main() -> None:
    super_email = os.environ.get("SUPER_EMAIL") or fail("falta SUPER_EMAIL")
    super_password = os.environ.get("SUPER_PASSWORD") or fail("falta SUPER_PASSWORD")
    purge_password = env_value("PURGE_PASSWORD") or env_value("PLATFORM_PURGE_PASSWORD") or fail(
        "falta PURGE_PASSWORD (o PLATFORM_PURGE_PASSWORD en .env.prod)")

    log(f"API: {API_URL} · tenant: {TENANT_ID} · zona: {ZONE_NAME} · modo: {'EJECUTAR' if CONFIRM else 'PLAN (sin cambios)'}")

    # ── Estado actual (solo lectura) ─────────────────────────────────────────────
    counts = psql(f"""
      select (select count(*) from borrower where tenant_id='{TENANT_ID}'),
             (select count(*) from credit where tenant_id='{TENANT_ID}'),
             (select count(*) from payment where tenant_id='{TENANT_ID}'),
             (select count(*) from cash_box where tenant_id='{TENANT_ID}');""").split("|")
    log(f"Datos actuales: {counts[0]} clientes · {counts[1]} créditos · {counts[2]} pagos · {counts[3]} cajas")
    users_now = psql(f"select email||' ('||role||(case when active then '' else ', inactivo' end)||')' from app_user where tenant_id='{TENANT_ID}' order by role,email")
    log("Usuarios: " + "; ".join(users_now.splitlines()))
    zones_now = psql(f"select name||' ['||path::text||']' from zone where tenant_id='{TENANT_ID}' order by path")
    log("Zonas: " + "; ".join(zones_now.splitlines()))

    plan = [
        "respaldo de la base", "ADMIN temporal", "PURGA de datos de prueba",
        f"zona raíz '{ZONE_NAME}' + mover canales WA/TG", "coordinador1/cobrador1/cobrador2 y desactivar el resto",
        "eliminar zonas sobrantes", f"conservar solo la cuenta bancaria '{KEEP_BANK_ACCOUNT}'",
        "cajas: oficina, bancaria y una de ruta por cobrador", f"idioma {CLIENT_LANGUAGE}, zona horaria {TIME_ZONE}",
    ]
    log("Plan: " + " → ".join(plan))
    if not CONFIRM:
        log("Nada se cambió. Para ejecutar: CONFIRM=SI")
        return

    # ── 1. Respaldo ──────────────────────────────────────────────────────────────
    dump = backup()
    log(f"✔ respaldo: {dump} ({dump.stat().st_size // 1024} KiB)")

    # ── 2. Sesiones ──────────────────────────────────────────────────────────────
    platform = Api().login(super_email, super_password)
    log("✔ sesión de plataforma")
    admins = list_all(platform, f"/admin/tenants/{TENANT_ID}/admins")
    temp_password = gen_password()
    existing = next((a for a in admins if a["email"] == TEMP_ADMIN_EMAIL), None)
    if existing:
        platform.call("PATCH", f"/admin/tenants/{TENANT_ID}/admins/{existing['id']}", {"active": True, "password": temp_password})
        temp_admin_id = existing["id"]
    else:
        created = platform.call("POST", f"/admin/tenants/{TENANT_ID}/admins", {"email": TEMP_ADMIN_EMAIL, "password": temp_password})
        temp_admin_id = created["id"]
    admin = Api().login(TEMP_ADMIN_EMAIL, temp_password)
    admin.tenant_id = TENANT_ID
    log(f"✔ ADMIN temporal {TEMP_ADMIN_EMAIL}")

    try:
        # ── 3. Purga ─────────────────────────────────────────────────────────────
        report = platform.call("POST", f"/admin/tenants/{TENANT_ID}/purge", {"confirmationPassword": purge_password})
        log(f"✔ purga: {report.get('rowsDeleted', 0)} filas borradas en {len(report.get('tables', {}))} tablas; "
            f"{report.get('filesDeleted', 0)} archivos eliminados del almacén")

        # ── 4. Zona raíz + canales ───────────────────────────────────────────────
        zones = admin.call("GET", "/zones").get("items", [])
        target = next((z for z in zones if z["parentZoneId"] is None and z["name"] == ZONE_NAME), None)
        if not target:
            created = admin.call("POST", "/zones", {"name": ZONE_NAME, "parentZoneId": None})
            target = {"id": created["id"], "path": created["path"], "name": ZONE_NAME}
        zone_id, zone_path = target["id"], target["path"]
        moved = psql(f"""
          update whatsapp_channel set zone_id='{zone_id}', zone_path='{zone_path}' where tenant_id='{TENANT_ID}';
          update telegram_channel set zone_id='{zone_id}', zone_path='{zone_path}' where tenant_id='{TENANT_ID}';
          delete from zone_coordinator where tenant_id='{TENANT_ID}';
          select (select count(*) from whatsapp_channel where tenant_id='{TENANT_ID}' and zone_id='{zone_id}'),
                 (select count(*) from telegram_channel where tenant_id='{TENANT_ID}' and zone_id='{zone_id}');""").split("|")
        log(f"✔ zona '{ZONE_NAME}' [{zone_path}] · canales en la zona: WhatsApp {moved[0]}, Telegram {moved[1]}")

        # ── 5. Equipo ────────────────────────────────────────────────────────────
        users = list_all(admin, "/users")
        by_email = {u["email"]: u for u in users}
        credentials: list[tuple[str, str, str]] = []
        team_ids: dict[str, str] = {}
        for local, role, pw_var in TEAM:
            email = f"{local}@{USERS_DOMAIN}"
            password = os.environ.get(pw_var) or gen_password()
            if email in by_email:
                admin.call("PATCH", f"/users/{by_email[email]['id']}", {"zonePaths": [zone_path], "active": True})
                team_ids[email] = by_email[email]["id"]
                credentials.append((email, role, "(contraseña sin cambio: el usuario ya existía)"))
            else:
                created = admin.call("POST", "/users", {"email": email, "password": password, "role": role, "zonePaths": [zone_path]})
                team_ids[email] = created["id"]
                credentials.append((email, role, password))
        deactivated = []
        for u in users:
            if u["role"] in ("COORDINATOR", "COLLECTOR") and u["email"] not in team_ids and u["active"]:
                admin.call("PATCH", f"/users/{u['id']}", {"active": False})
                deactivated.append(u["email"])
        admin.call("POST", f"/zones/{zone_id}/coordinators", {"coordinatorId": team_ids[f"coordinador1@{USERS_DOMAIN}"]})
        log(f"✔ equipo: {', '.join(team_ids)} · desactivados: {', '.join(deactivated) or 'ninguno'}")

        # ── 6. Zonas sobrantes (hojas primero) ───────────────────────────────────
        leftovers = [z for z in admin.call("GET", "/zones").get("items", []) if z["id"] != zone_id]
        removed, kept = [], []
        for z in sorted(leftovers, key=lambda z: -z["path"].count(".")):
            try:
                admin.call("DELETE", f"/zones/{z['id']}", {})
                removed.append(z["name"])
            except RuntimeError as e:
                kept.append(f"{z['name']}: {e}")
        log(f"✔ zonas eliminadas: {', '.join(removed) or 'ninguna'}" + (f" · NO eliminadas: {'; '.join(kept)}" if kept else ""))

        # ── 7. Cuentas bancarias ─────────────────────────────────────────────────
        accounts = admin.call("GET", "/bank-accounts").get("items", [])
        keep = next((a for a in accounts if KEEP_BANK_ACCOUNT in (a["label"] + " " + a["bankName"]).lower()), None)
        for a in accounts:
            if keep and a["id"] == keep["id"]:
                continue
            admin.call("DELETE", f"/bank-accounts/{a['id']}", {})
        log(f"✔ cuenta bancaria conservada: {keep['label'] if keep else 'ninguna (no había coincidencia)'} · eliminadas: {len(accounts) - (1 if keep else 0)}")

        # ── 8. Cajas ─────────────────────────────────────────────────────────────
        boxes = admin.call("GET", "/cash/boxes").get("items", [])
        def ensure_box(spec: dict) -> None:
            if any(b["name"] == spec["name"] for b in boxes):
                return
            admin.call("POST", "/cash/boxes", spec)
        ensure_box({"type": "CASH", "name": OFFICE_BOX_NAME, "zoneId": zone_id})
        if keep:
            ensure_box({"type": "BANK", "name": keep["label"], "bankAccountId": keep["id"], "zoneId": zone_id})
        for local, role, _ in TEAM:
            if role == "COLLECTOR":
                ensure_box({"type": "CASH", "name": f"Ruta {local}", "zoneId": zone_id, "assignedTo": team_ids[f"{local}@{USERS_DOMAIN}"]})
        names = [b["name"] for b in admin.call("GET", "/cash/boxes").get("items", [])]
        log(f"✔ cajas: {', '.join(names)}")

        # ── 9. Configuración ─────────────────────────────────────────────────────
        admin.call("PATCH", "/tenant-config/client-language", {"language": CLIENT_LANGUAGE})
        admin.call("PATCH", "/tenant-config/operational-settings", {"timeZone": TIME_ZONE})
        admin.call("PATCH", "/tenant-config/messaging-channels", {"whatsappEnabled": True, "telegramEnabled": True})
        log(f"✔ idioma de atención {CLIENT_LANGUAGE} · zona horaria {TIME_ZONE} · WhatsApp y Telegram habilitados")
    finally:
        platform.call("PATCH", f"/admin/tenants/{TENANT_ID}/admins/{temp_admin_id}", {"active": False})
        log(f"✔ ADMIN temporal {TEMP_ADMIN_EMAIL} desactivado")

    log("\n=== CREDENCIALES (guárdalas ahora; no se vuelven a mostrar) ===")
    for email, role, password in credentials:
        log(f"  {role:<12} {email:<32} {password}")
    log("\nListo. Siguiente paso: entrar como coordinador1, crear el primer cliente y otorgar el primer crédito.")


if __name__ == "__main__":
    main()
