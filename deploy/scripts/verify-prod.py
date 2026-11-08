#!/usr/bin/env python3
"""
Verificación de SOLO LECTURA de producción tras un despliegue. No crea ni modifica datos de negocio:
solo inicia sesión, consulta endpoints y comprueba que respondan con la forma esperada. Lo único que
toca es el ADMIN temporal `setup-brasil@…` (lo reactiva con una contraseña aleatoria para consultar y
lo vuelve a desactivar al final).

Uso (en el servidor o en tu máquina):
  SUPER_EMAIL=… SUPER_PASSWORD=… COLLECTOR_EMAIL=cobrador1@preztia.co COLLECTOR_PASSWORD=… \\
    python3 deploy/scripts/verify-prod.py
Variables opcionales: API_URL (https://api.preztia.co), APP_URL (https://app.preztia.co), TENANT_ID,
USERS_DOMAIN (preztia.co), EXPECT_STRINGS (textos separados por | que deben estar en el bundle web).
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request

API = os.environ.get("API_URL", "https://api.preztia.co").rstrip("/")
APP = os.environ.get("APP_URL", "https://app.preztia.co").rstrip("/")
TENANT = os.environ.get("TENANT_ID", "00000000-0000-0000-0000-000000000001")
DOMAIN = os.environ.get("USERS_DOMAIN", "preztia.co")
TEMP_ADMIN = f"setup-brasil@{DOMAIN}"
# Fragmentos SIN acentos ni eñes: el bundle minificado escapa los caracteres no ASCII (\xf1, \xea).
EXPECT_STRINGS = os.environ.get(
    "EXPECT_STRINGS", "Mis cobros de hoy|Entregas de cobradores|Portugu|Cambiar contrase"
).split("|")

failures = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global failures
    print(("✔ " if ok else "✖ ") + label + (f" · {detail}" if detail else ""), flush=True)
    if not ok:
        failures += 1


def call(method: str, path: str, body=None, token: str | None = None, tenant=True, ok=(200, 201, 204)):
    headers = {"content-type": "application/json", "accept": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    if tenant:
        headers["x-tenant-id"] = TENANT
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw, status = res.read(), res.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    payload = json.loads(raw) if raw else {}
    if status not in ok:
        raise RuntimeError(f"{method} {path} → HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:200]}")
    return payload


def login(email: str, password: str) -> str:
    return call("POST", "/auth/login", {"email": email, "password": password}, tenant=False)["accessToken"]


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as res:
        return res.read().decode("utf-8", "replace")


def main() -> None:
    # 1) Web app publicada con el bundle esperado (un fallo aquí no detiene el resto)
    try:
        html = fetch_text(f"{APP}/")
        bundle = next((p for p in html.split('"') if p.startswith("/_expo/static/js/web/") and p.endswith(".js")), None)
        check("web app responde y referencia un bundle", bundle is not None, bundle or "")
        if bundle:
            js = fetch_text(f"{APP}{bundle}")
            for text in (t for t in EXPECT_STRINGS if t):
                check(f"bundle contiene «{text}»", text in js)
    except (urllib.error.URLError, OSError) as e:
        check("web app responde", False, str(e)[:120])

    # 2) Cobrador real: sesión, lista operativa del día, refresco de token
    col_email = os.environ.get("COLLECTOR_EMAIL")
    col_password = os.environ.get("COLLECTOR_PASSWORD")
    if col_email and col_password:
        tokens = call("POST", "/auth/login", {"email": col_email, "password": col_password}, tenant=False)
        today = call("GET", "/me/collection-today?page=1&pageSize=5", token=tokens["accessToken"])
        check("cobrador: Mis cobros de hoy responde", "summary" in today and "date" in today, f"fecha {today.get('date')} · {today.get('summary')}")
        refreshed = call("POST", "/auth/refresh", {"refreshToken": tokens["refreshToken"]}, tenant=False)
        check("cobrador: el refresh token renueva la sesión", bool(refreshed.get("accessToken")))
        box = call("GET", "/me/cash-box", token=tokens["accessToken"])
        check("cobrador: tiene caja de ruta", box.get("box") is not None, (box.get("box") or {}).get("name", ""))
    else:
        print("  (sin COLLECTOR_EMAIL/COLLECTOR_PASSWORD: se omite la verificación del cobrador)")

    # 3) Administración: panel Hoy/Pendientes, usuarios con nombre, cotización, solicitudes
    super_email, super_password = os.environ.get("SUPER_EMAIL"), os.environ.get("SUPER_PASSWORD")
    if super_email and super_password:
        sup = login(super_email, super_password)
        admins = call("GET", f"/admin/tenants/{TENANT}/admins?page=1&pageSize=100", token=sup, tenant=False)["items"]
        temp = next((a for a in admins if a["email"] == TEMP_ADMIN), None)
        if temp:
            pw = "Pz-" + secrets.token_hex(8)
            call("PATCH", f"/admin/tenants/{TENANT}/admins/{temp['id']}", {"active": True, "password": pw}, token=sup, tenant=False)
            try:
                adm = login(TEMP_ADMIN, pw)
                kpis = call("GET", "/dashboard/kpis", token=adm)
                check("panel: bloques today y pending", "today" in kpis and "pending" in kpis,
                      f"hoy {kpis.get('today', {}).get('date')} · cobrado {kpis.get('today', {}).get('collectedMinor')} · pendientes {kpis.get('pending')}")
                users = call("GET", "/users?page=1&pageSize=100", token=adm)["items"]
                check("usuarios: el listado trae displayName", all("displayName" in u for u in users), f"{len(users)} usuarios")
                quote = call("POST", "/credits/quote", {"principalMinor": 100_000, "interestPct": 200, "installmentsCount": 20, "frequency": "DAILY"}, token=adm)
                check("cotización: Σ cuotas = total", sum(i["amountDueMinor"] for i in quote["installments"]) == quote["totalDueMinor"], f"total {quote['totalDueMinor']}")
                apps = call("GET", "/applications?page=1&pageSize=1", token=adm)
                check("solicitudes: listado responde", "items" in apps, f"{apps.get('total')} en total")
                report = call("GET", "/reports/daily", token=adm)
                check("reporte diario: fecha de negocio presente", bool(report.get("date")), report.get("date", ""))
                board = call("GET", "/remittances/board?page=1&pageSize=5", token=adm)
                check("entregas: tablero responde", "items" in board, f"{board.get('total')} cobradores")
                # Una sola tesorería: Inicio, Dinero y Operación deben dar la MISMA liquidez disponible.
                cash = call("GET", "/cash/dashboard", token=adm)
                ops = call("GET", "/reports/dashboard", token=adm)
                home_available = kpis.get("treasury", {}).get("availableMinor")
                check(
                    "tesorería: la misma liquidez en Inicio, Dinero y Operación",
                    home_available is not None
                    and home_available == cash.get("treasury", {}).get("availableMinor") == ops.get("cashCurrentMinor"),
                    f"inicio {home_available} · dinero {cash.get('treasury', {}).get('availableMinor')} · operación {ops.get('cashCurrentMinor')}",
                )
                tre = cash.get("treasury", {})
                check(
                    "tesorería: total = oficina + ruta + bancos + tránsito",
                    tre and tre["totalMinor"] == tre["officeMinor"] + tre["routeMinor"] + tre["bankMinor"] + tre["transitMinor"],
                    f"total {tre.get('totalMinor')}",
                )
                first_borrower = call("GET", "/borrowers?page=1&pageSize=1", token=adm)["items"]
                if first_borrower:
                    detail = call("GET", f"/borrowers/{first_borrower[0]['id']}", token=adm)
                    check("cliente: la ficha por id responde", detail.get("id") == first_borrower[0]["id"])
                else:
                    print("  (sin clientes: la ficha por id no se verifica en vivo)")
            finally:
                call("PATCH", f"/admin/tenants/{TENANT}/admins/{temp['id']}", {"active": False}, token=sup, tenant=False)
        else:
            print(f"  (no existe {TEMP_ADMIN}: se omite la verificación de administración)")
    else:
        print("  (sin SUPER_EMAIL/SUPER_PASSWORD: se omite la verificación de administración)")

    print("\nRESULTADO:", "TODO OK" if failures == 0 else f"{failures} comprobación(es) fallida(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
