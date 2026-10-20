# Seed completo de PreztiaOS (`seed:full`)

Reemplaza los datos de la base por **~10 semanas de operación simulada** que ejercitan todas las
funcionalidades: originación por chat con KYC, cartera, cobro en efectivo y PIX, conciliación,
cajas, rendiciones, consignaciones, rutas, visitas, gastos, liquidaciones selladas y comisiones.

```bash
pnpm build                       # el seed importa dist/ de los paquetes
pnpm --filter api seed:full      # ~15 s en local
```

## Cómo produce los datos

- **Simulación cronológica** día por día en la zona horaria de la empresa. Cada hecho recibe un
  instante real y creciente dentro de su día, así los cortes (rendición, liquidación) y los
  órdenes por `created_at` quedan como los dejaría la operación.
- **Mismas reglas que la API**: cronogramas (`buildSchedule`), cascada de abonos
  (`allocatePayment`), desglose capital/interés (`splitAllocations`), saldo de cajas
  (`assertCanPost`), atribución por zona (`ledgerAttribution`), rendición
  (`summarizeRemittance`), cupo, bloqueo del interés, fechas de pago, etc. Un dato que el dominio
  rechazaría hace fallar el seed.
- **Liquidaciones selladas por el sistema real**: cada período se cierra con el
  `SettlementRepository` de la API (con un "ahora" simulado), no con una foto armada a mano.
- **Verificación final**: 19 invariantes sobre la base (saldos nunca negativos, Σ asignaciones =
  pagado, un desembolso por crédito, transferencias que suman cero, comisiones = foto sellada,
  rendición reconstruida por la API = saldo del libro, …). Si alguno falla, el comando sale con
  código 1.
- **Evidencias reales**: comprobantes PIX, documentos KYC, recibos de gastos y de consignaciones
  se generan como PNG/PDF legibles y se suben **cifrados** a MinIO con las mismas claves que usa la
  API (el botón "ver original" funciona). Sin MinIO, el seed sigue sin archivos.
- **Determinista**: la misma fecha produce los mismos datos (semilla fija por tenant).

## Tenants sembrados

| Tenant | Moneda / zona horaria | Qué cubre |
|---|---|---|
| **Preztia** (`…0001`, el real si ya existe) | BRL · America/Sao_Paulo | Estructura de producción: Minas Gerais (Divinópolis, Belo Horizonte, Contagem sin operación) y São Paulo (Capital, Campinas); todo el catálogo de casos de abajo. |
| **Créditos Antioquia (demo)** (`…0002`) | COP · America/Bogota | Multi-tenant y multi-país: liquidación MENSUAL, comisiones apagadas, modo flexible de fechas, el cliente elige el plan, chat en español, solo efectivo. |
| **Financiera Norte (suspendida)** (`…0003`) | BRL | Tenant SUSPENDED con un ADMIN y sin datos: su login responde 403 `TENANT_SUSPENDED` (ADR #49). |

## Usuarios

| Rol | Email |
|---|---|
| SUPER_ADMIN | `super@preztia.co` |
| ADMIN | `admin@preztia.co` · `admin.antioquia@preztia.co` · `admin.suspendida@preztia.co` |
| COORDINATOR | `coordinador.mg@preztia.co` (minas_gerais) · `coordinador.sp@preztia.co` (sao_paulo) · `coordinador.antioquia@preztia.co` |
| COLLECTOR | `cobrador.divinopolis@` · `cobrador.bh@` · `cobrador.saopaulo@` · `cobrador.campinas@` · `cobrador.medellin@` · `cobrador.envigado@` (todos `@preztia.co`) |
| COLLECTOR inactivo | `cobrador.retirado@preztia.co` (se retiró en la semana 4: deuda condonada, caja desactivada, cartera traspasada) |

Contraseña de los usuarios **nuevos**: `Preztia#2026` en local, o la de `SEED_PASSWORD`. Los
usuarios que ya existían **conservan su contraseña**.

## Catálogo de casos (tenant principal)

**Cartera** — créditos diarios, semanales, quincenales y mensuales; ACTIVE (al día, con atraso, con
abonos parciales, en mora creciente), SETTLED (pagados, saldados antes de tiempo, con sobrepago) y
MIGRATED (con abonos históricos sin libro; uno saldado, uno castigado `DEFAULTED`, uno anulado
`CANCELLED`). Renovaciones, un cliente con dos créditos vigentes, interés "Personalizado" del
ADMIN, un cliente con el cupo al tope (un nuevo crédito da `OVER_LIMIT`), un cliente bloqueado,
clientes sin préstamos y sin geolocalización, todos los colores.

**Pagos** — efectivo en ruta (con `Idempotency-Key`), captura sin señal dentro de la ventana
(`BACKDATE payment`) y demasiado vieja (`ADJUST payment-date`); pagos recibidos en la OFICINA
(ADR #48): el ADMIN registra uno de ayer con fecha manual y el coordinador uno de hoy, ambos en la
caja de oficina de la zona y sin atribuirse a un cobrador; todo abono que salda la cartera deja el
crédito SETTLED con su evento `credit_settled`; PIX verificado en línea (Inter),
PIX PicPay conciliado con el webhook y validado por el coordinador, conciliación automática
(historia), pendiente de aprobación humana, sin webhook todavía, banco no disponible (en
conciliación), monto leído distinto del confirmado (el pago queda por lo que confirmó el banco y
lo leído queda en el evento), comprobante duplicado (fraude), falso
positivo validado por el ADMIN, ilegible, huérfano, reenvío duplicado ignorado, llave PIX
desconocida (Tránsito, una reclasificada y otra pendiente) y sobrepago.

**Cobro conversacional PicPay** — sesiones esperando elección, cobranças pendientes, pagadas,
expiradas, canceladas y fallidas, con sus webhooks.

**Originación por chat** — solicitudes en cada estado: recién iniciada, documentos a medias, un
documento RECHAZADO, solo el anverso de la cédula, fallo técnico, en revisión sin oferta, menú de
planes enviado, esperando aceptación, aceptada (lista para crear), declinada, oferta vencida,
aprobada (con y sin override), rechazada (con motivo), re-estudio con dos veredictos, documento
reutilizado (sospechoso), revisión manual y dictamen de visión LOW/MEDIUM/HIGH. Incluye una por
Telegram y conversaciones de solo consulta (una fuera de tema y una con fallo técnico).

**Campo** — rutas despachadas con paradas PAGÓ / NO PAGÓ / PROMESA / NO ENCONTRADO / canceladas
(y la de hoy a medias), visitas con observación (pendientes, visitadas y por re-visitar),
recorrido GPS de los últimos días, gastos aprobados (desde la ruta o la oficina), rechazados con
motivo y pendientes, consignaciones verificadas con su ingreso bancario, objetada y corregida,
objetada abierta, cancelada, reportada esperando verificación e emitida sin ver.

**Rendiciones** — puntuales, tarde, con faltante (deuda arrastrada), cierre de deuda por nómina y
por condonación; hoy: una declarada esperando recepción, una pendiente, una atrasada y una al día.

**Tesorería** — saldos de apertura por arqueo, provisión de efectivo, aporte de capital, retiros,
barridos a tesorería, arqueos que cuadran y con descuadre ajustado, un arqueo con descuadre SIN
ajustar (hoy), sincronización de saldo MATCHED / MISMATCH / UNAVAILABLE.

**Liquidaciones** — períodos semanales sellados por el cierre automático, uno cerrado a mano y
tarde (retroactivo), comisiones causadas por zona (con herencia y una recortada por el tope)
pagadas desde la oficina o desde la ruta; la del último período queda sin pagar.

**Configuración** — 9 planes (2 inactivos), catálogo KYC (2 documentos inactivos), 4 cuentas
bancarias (PicPay, Inter, Mercado Pago con validación apagada, Caixa manual), cajas de cada tipo
(una desactivada), canales WhatsApp y Telegram por zona, listas de clientes, solicitudes de
cambio aprobadas/rechazadas/pendientes, notas y recordatorios enviados a mano.

## Seguridad (local vs. producción)

- **Falla cerrado**: con una base que no es `localhost` o con `NODE_ENV=production` exige
  `SEED_CONFIRM=REEMPLAZAR-DATOS` y `SEED_PASSWORD` (≥ 12 caracteres). Si existen tenants que el
  seed no administra, también se niega salvo esa confirmación.
- **Conserva lo real**: credencial de IA, base de conocimiento, canales de WhatsApp y Telegram
  (con sus secretos cifrados, en la zona de igual ruta), cuentas bancarias con sus credenciales y
  llaves PIX, la identidad del tenant y las contraseñas y usuarios que ya existían.
- **Canales reales, sin canales inventados**: si el tenant tiene menos canales que zonas (p. ej.
  un solo número en Divinópolis), las solicitudes de las zonas sin canal entran por ese número y
  nacen en su zona, como en la API: las revisa su coordinador y se desembolsan desde una caja de
  esa zona.
- **Sin mensajes a personas reales**: los teléfonos sembrados están en bloques no asignables
  (`55 DDD 9 0000-xxxx`, `57 399…`) y el recordatorio automático queda **apagado**.

## Producción

```bash
# Respaldo primero (el seed BORRA todos los datos de negocio).
docker compose -f docker-compose.prod.yml exec api sh -c \
  'SEED_CONFIRM=REEMPLAZAR-DATOS SEED_PASSWORD="<contraseña-fuerte>" pnpm --filter api seed:full'
```

Variables opcionales: `SEED_TENANT_ID` (id del tenant principal si no se detecta solo),
`SEED_RESET_PASSWORDS=yes` (reemplaza también las contraseñas existentes), `SEED_SKIP_FILES=yes`
(sin evidencias en MinIO), `SEED_WHATSAPP_PHONE_NUMBER_ID` (canal demo de Divinópolis cuando no hay
uno real).
