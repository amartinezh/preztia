import type { BadgeTone } from "@preztiaos/ui";
import type {
  CreditApplicationStatus,
  VerdictStatus,
} from "@preztiaos/contracts";

type Badge = { tone: BadgeTone; label: string };

/**
 * Traduce el veredicto antifraude a tono visual + etiqueta. Verde = OK (approved),
 * ámbar = sospechoso, rojo = rechazado, neutro = sin análisis todavía.
 */
export function verdictBadge(status: VerdictStatus | null): Badge {
  switch (status) {
    case "approved":
      return { tone: "success", label: "Aprobado" };
    case "suspicious":
      return { tone: "warning", label: "Sospechoso" };
    case "rejected":
      return { tone: "danger", label: "Rechazado" };
    case null:
      return { tone: "neutral", label: "Sin análisis" };
  }
}

/** Estado del expediente KYC → tono + etiqueta. */
export function applicationStatusBadge(status: CreditApplicationStatus): Badge {
  switch (status) {
    case "AWAITING_DOCUMENTS":
      return { tone: "neutral", label: "Esperando documentos" };
    case "IN_REVIEW":
      return { tone: "info", label: "En revisión" };
    case "APPROVED":
      return { tone: "success", label: "Aprobado" };
    case "REJECTED":
      return { tone: "danger", label: "Rechazado" };
  }
}

/** Estado de un documento individual → tono + etiqueta. */
export function documentStatusBadge(
  status: "PENDING" | "RECEIVED" | "VALIDATED" | "REJECTED",
): Badge {
  switch (status) {
    case "PENDING":
      return { tone: "neutral", label: "Pendiente" };
    case "RECEIVED":
      return { tone: "info", label: "Recibido" };
    case "VALIDATED":
      return { tone: "success", label: "Validado" };
    case "REJECTED":
      return { tone: "danger", label: "Rechazado" };
  }
}

/** Severidad de una alerta antifraude → tono. */
export function severityTone(severidad: string): BadgeTone {
  switch (severidad) {
    case "CRITICA":
    case "ALTA":
      return "danger";
    case "MEDIA":
      return "warning";
    default:
      return "neutral";
  }
}

// Etiqueta legible de cada tipo de documento KYC.
export const DOCUMENT_LABELS: Record<string, string> = {
  IDENTITY_DOCUMENT: "Documento de identidad",
  BUSINESS_VALIDITY_CERTIFICATE: "Certificado de actividad",
  PUBLIC_SERVICES_RECEIPT: "Recibo de servicios",
  BANK_STATEMENT: "Extracto bancario",
  INCOME_PROOF: "Comprobante de ingresos",
};

export function documentLabel(type: string): string {
  return DOCUMENT_LABELS[type] ?? type;
}
