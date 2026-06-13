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
