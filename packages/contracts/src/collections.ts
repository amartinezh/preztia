import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de COBRANZA por WhatsApp (vista de Cartera/Gestión de Créditos). El historial del hilo
// se consulta con `getConversationThread` (contrato conversations-inbox); aquí va el panel de cobro
// de un crédito y el disparo MANUAL del recordatorio. El envío AUTOMÁTICO lo hace el cron (sin HTTP).

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

// Panel de cobranza de un crédito: cuánto debe hoy, su teléfono (para abrir el historial) y si se
// puede recordar. El teléfono va en claro porque el revisor (coordinador/ADMIN) ya está autorizado
// y lo necesita para el hilo; igual que `getConversationThread`.
export const creditCollectionPanel = z.object({
  creditId: z.string().uuid(),
  firstName: z.string(),
  phone: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  dueMinor: z.number().int(),
  currency: z.string(),
  /** ¿El tenant tiene llave PIX configurada? Sin ella no se puede enviar el recordatorio. */
  pixConfigured: z.boolean(),
});
export type CreditCollectionPanel = z.infer<typeof creditCollectionPanel>;

// Resultado del envío manual. `sent=false` con un motivo accionable para la UI (nada por cobrar,
// ya enviado hoy, sin teléfono). El texto enviado se devuelve para reflejarlo de inmediato.
export const sendReminderOutput = z.object({
  sent: z.boolean(),
  reason: z
    .enum(["NO_ACTIVE_CREDIT", "NOTHING_DUE", "NO_PIX_KEY", "ALREADY_SENT_TODAY"])
    .nullable(),
  phone: z.string().nullable(),
  dueMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  messagePreview: z.string().nullable(),
});
export type SendReminderOutput = z.infer<typeof sendReminderOutput>;

// ── Mapa de cobro: clientes críticos por alta mora (ruta de cobranza inteligente) ───────────
// Cliente CRÍTICO: crédito activo con nº de cuotas vencidas ≥ umbral (env CRITICAL_OVERDUE_THRESHOLD)
// y con coordenadas del cliente registradas (para poder ubicarlo y rutearlo).
export const criticalClient = z.object({
  creditId: z.string().uuid(),
  borrowerName: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  overdueCount: z.number().int(),
  daysOverdue: z.number().int(),
  outstandingMinor: z.number().int(),
  currency: z.string(),
});
export type CriticalClient = z.infer<typeof criticalClient>;

export const listCriticalClientsOutput = z.object({
  // Umbral vigente (nº de cuotas vencidas) con el que se marcó "crítico"; informa la UI.
  threshold: z.number().int(),
  items: z.array(criticalClient),
});

// ── Mapa de cartera: TODOS los clientes con crédito activo y coordenadas ────────────────────
// Vista complementaria al mapa crítico: ubica a toda la cartera activa en el mapa; al tocar un
// marcador la UI muestra el detalle completo del crédito. `critical` replica el umbral del mapa
// de cobro para pintar el marcador según severidad (al día / en mora / crítico).
export const portfolioMapClient = z.object({
  creditId: z.string().uuid(),
  borrowerName: z.string(),
  // Teléfono en claro: el consumidor es un revisor autorizado (igual que el panel de cobranza).
  phone: z.string().nullable(),
  business: z.string().nullable(),
  zoneName: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  principalMinor: z.number().int(),
  totalDueMinor: z.number().int(),
  paidMinor: z.number().int(),
  outstandingMinor: z.number().int(),
  currency: z.string(),
  installmentsCount: z.number().int(),
  installmentsPaid: z.number().int(),
  overdueCount: z.number().int(),
  daysOverdue: z.number().int(),
  // Próxima cuota pendiente (ISO date); null si ya no queda ninguna por saldar.
  nextDueDate: z.string().nullable(),
  startDate: z.string(),
  critical: z.boolean(),
});
export type PortfolioMapClient = z.infer<typeof portfolioMapClient>;

export const listPortfolioMapOutput = z.object({
  // Umbral vigente (nº de cuotas vencidas) con el que se marcó `critical`; informa la UI.
  threshold: z.number().int(),
  items: z.array(portfolioMapClient),
});

// Un punto de la geografía (cliente o punto de partida del cobrador).
export const geoPoint = z.object({ latitude: z.number(), longitude: z.number() });

// Parada optimizada de la ruta crítica (en el orden de visita sugerido).
export const routeStop = criticalClient.extend({ order: z.number().int() });

export const criticalRouteInput = z.object({
  // Punto de consulta: ubicación actual del cobrador (origen de la ruta).
  start: geoPoint,
});

export const criticalRouteOutput = z.object({
  // Paradas en el ORDEN óptimo de visita (1..N) calculado por el motor de rutas.
  stops: z.array(routeStop),
  // Geometría de la ruta como lista de puntos para dibujar la polilínea en el mapa.
  geometry: z.array(geoPoint),
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  // true si el motor de rutas no estuvo disponible y se devolvió un orden de respaldo sin geometría.
  degraded: z.boolean(),
});
export type CriticalRouteOutput = z.infer<typeof criticalRouteOutput>;

export const collectionsContract = c.router({
  getCreditCollection: {
    method: "GET",
    path: "/credits/:creditId/collection",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    responses: { 200: creditCollectionPanel },
    summary: "Panel de cobranza de un crédito: cuota de hoy, teléfono y estado PIX",
  },
  sendCollectionReminder: {
    method: "POST",
    path: "/credits/:creditId/collection-reminder",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: sendReminderOutput },
    summary:
      "Envía manualmente el recordatorio de cobro por WhatsApp (idempotente por crédito y día)",
  },
  listCriticalClients: {
    method: "GET",
    path: "/collections/critical-clients",
    headers: tenantHeaders,
    responses: { 200: listCriticalClientsOutput },
    summary: "Clientes en mora crítica (≥ umbral de cuotas vencidas) con coordenadas, para el mapa",
  },
  listPortfolioMap: {
    method: "GET",
    path: "/collections/portfolio-map",
    headers: tenantHeaders,
    responses: { 200: listPortfolioMapOutput },
    summary: "Toda la cartera activa con coordenadas y detalle del crédito, para el mapa de clientes",
  },
  criticalRoute: {
    method: "POST",
    path: "/collections/critical-route",
    headers: tenantHeaders,
    body: criticalRouteInput,
    responses: { 200: criticalRouteOutput },
    summary: "Genera la ruta de cobro óptima (OSRM) que visita a los clientes críticos desde el origen",
  },
});
