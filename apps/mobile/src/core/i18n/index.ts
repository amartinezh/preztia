/**
 * i18n mínimo sin dependencias. El dominio y los comentarios están en español; los textos
 * de UI viven aquí para poder añadir `pt-BR` (Brasil) sin tocar las pantallas. La detección
 * de locale usa `Intl` (sin librerías), con `es` por defecto.
 */

export type Locale = "es" | "pt-BR";

const es = {
  "app.name": "PreztiaOS",
  "auth.signIn": "Iniciar sesión",
  "auth.email": "Correo",
  "auth.password": "Contraseña",
  "auth.signingIn": "Ingresando…",
  "auth.signOut": "Cerrar sesión",
  "credit.list.title": "Créditos",
  "credit.list.empty": "Aún no hay créditos en tu alcance",
  "credit.new.title": "Otorgar crédito",
  "credit.new.principal": "Capital",
  "credit.new.interest": "Interés (%)",
  "credit.new.installments": "Número de cuotas",
  "credit.new.submit": "Otorgar crédito",
  "credit.portfolio.balance": "Saldo",
  "credit.portfolio.installments": "Cuotas",
  "payments.title": "Pagos",
  "payments.register": "Registrar pago",
  "payments.empty": "Sin pagos registrados",
  "review.tab": "Revisión",
  "review.list.title": "Revisión de solicitudes",
  "review.list.empty": "No hay solicitudes para revisar",
  "review.detail.title": "Expediente",
  "review.detail.documents": "Documentos",
  "review.detail.history": "Historial antifraude",
  "review.detail.noHistory": "Aún no hay corridas del análisis antifraude",
  "review.detail.viewConversation": "Ver conversación",
  "review.detail.viewOriginal": "Ver original",
  "review.detail.score": "Riesgo",
  "review.detail.confidence": "Confianza",
  "review.detail.manualReview": "Revisión manual",
  "review.detail.sources": "Fuentes consultadas",
  "review.conversation.title": "Conversación con el cliente",
  "review.conversation.empty": "Sin mensajes registrados",
  "review.original.title": "Documento original",
  "review.original.unsupported": "Vista previa no disponible; descarga el archivo.",
  "review.approve.title": "Aprobar y generar crédito",
  "review.approve.submit": "Aprobar y generar crédito",
  "review.approve.reason": "Motivo de la decisión",
  "review.reject.title": "Rechazar solicitud",
  "review.reject.submit": "Rechazar",
  "review.reject.reason": "Motivo del rechazo",
  "review.verdict.approved": "Aprobado",
  "review.verdict.suspicious": "Sospechoso",
  "review.verdict.rejected": "Rechazado",
  "review.verdict.pending": "Sin análisis",
  // IAM — plano de control (super admin)
  "tenants.tab": "Tenants",
  "tenants.list.title": "Tenants",
  "tenants.list.empty": "Aún no hay tenants",
  "tenants.new.title": "Nuevo tenant",
  "tenants.new.name": "Nombre",
  "tenants.new.slug": "Slug (opcional)",
  "tenants.new.submit": "Crear tenant",
  "tenants.admin.title": "Crear admin del tenant",
  "tenants.admin.submit": "Crear admin",
  "tenants.status.active": "Activo",
  "tenants.status.suspended": "Suspendido",
  "tenants.action.suspend": "Suspender",
  "tenants.action.activate": "Activar",
  "tenants.action.delete": "Eliminar",
  // IAM — usuarios del tenant
  "users.tab": "Usuarios",
  "users.list.title": "Usuarios",
  "users.list.empty": "Aún no hay usuarios",
  "users.new.title": "Nuevo usuario",
  "users.new.email": "Correo",
  "users.new.password": "Contraseña",
  "users.new.role": "Rol",
  "users.new.zones": "Zonas (separadas por coma)",
  "users.new.submit": "Crear usuario",
  "users.role.coordinator": "Coordinador",
  "users.role.collector": "Cobrador",
  "users.active": "Activo",
  // IAM — zonas
  "zones.tab": "Zonas",
  "zones.list.title": "Zonas",
  "zones.list.empty": "Aún no hay zonas",
  "zones.new.title": "Nueva zona",
  "zones.new.name": "Nombre",
  "zones.new.parent": "Zona padre",
  "zones.new.root": "Zona raíz (sin padre)",
  "zones.new.submit": "Crear zona",
  "zones.action.delete": "Eliminar",
  // IAM — cobradores y clientes
  "collectors.tab": "Cobradores",
  "collectors.title": "Cobradores",
  "collectors.assign.title": "Asignar clientes",
  "collectors.assign.submit": "Guardar asignación",
  "collectors.assign.empty": "No hay clientes en tu alcance",
  "clients.tab": "Mis clientes",
  "clients.list.title": "Mis clientes",
  "clients.list.empty": "Aún no tienes clientes asignados",
  "common.create": "Crear",
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.delete": "Eliminar",
  "common.retry": "Reintentar",
  "common.amount": "Monto",
  "common.loading": "Cargando…",
  "common.offlineBanner": "Sin conexión. Tus cambios se enviarán al recuperar la red.",
  "errors.network": "No hay conexión con el servidor.",
  "errors.timeout": "La operación tardó demasiado. Intenta de nuevo.",
  "errors.unauthorized": "Tu sesión expiró. Inicia sesión nuevamente.",
  "errors.forbidden": "No tienes permiso para esta acción.",
  "errors.notFound": "No encontramos lo que buscas.",
  "errors.conflict": "La operación entra en conflicto con el estado actual.",
  "errors.validation": "Revisa los datos ingresados.",
  "errors.server": "Error del servidor. Intenta más tarde.",
  "errors.unknown": "Ocurrió un error inesperado.",
} as const;

export type MessageKey = keyof typeof es;

// pt-BR puede sobrescribir parcialmente; las claves faltantes caen a `es`.
const ptBR: Partial<Record<MessageKey, string>> = {
  "auth.signIn": "Entrar",
  "auth.email": "E-mail",
  "auth.password": "Senha",
  "credit.list.title": "Créditos",
  "errors.network": "Sem conexão com o servidor.",
};

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { es, "pt-BR": ptBR };

function detectLocale(): Locale {
  try {
    const tag = new Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (tag.startsWith("pt")) return "pt-BR";
  } catch {
    /* sin Intl: usar es */
  }
  return "es";
}

let activeLocale: Locale = detectLocale();

export function setLocale(locale: Locale) {
  activeLocale = locale;
}

export function t(key: MessageKey): string {
  return DICTS[activeLocale][key] ?? es[key] ?? key;
}

/** Hook de traducción. Hoy el locale es de módulo; el hook deja lista la futura reactividad. */
export function useT() {
  return { t, locale: activeLocale };
}
