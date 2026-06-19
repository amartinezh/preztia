import type { BadgeTone } from "@preztiaos/ui";
import type { PaymentSummary } from "@preztiaos/contracts";

/** Mapa estado de pago → presentación (color + etiqueta). Fuente única para lista y detalle. */
export function paymentBadge(status: PaymentSummary["status"]): { tone: BadgeTone; label: string } {
  switch (status) {
    case "VERIFIED":
      return { tone: "success", label: "Verificado" };
    case "RECEIVED":
      return { tone: "info", label: "Recibido" };
    case "UNVERIFIED":
      return { tone: "warning", label: "Sin verificar" };
    case "REJECTED_FRAUD":
      return { tone: "danger", label: "Fraude" };
    case "REJECTED_INVALID":
      return { tone: "danger", label: "Inválido" };
  }
}
