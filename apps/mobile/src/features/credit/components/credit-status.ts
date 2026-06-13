import type { BadgeTone } from "@preztiaos/ui";
import type { CreditStatus } from "@preztiaos/contracts";

/** Traduce el estado de un crédito a tono visual + etiqueta en español. */
export function creditStatusBadge(status: CreditStatus): { tone: BadgeTone; label: string } {
  switch (status) {
    case "PENDING":
      return { tone: "neutral", label: "Pendiente" };
    case "ACTIVE":
      return { tone: "info", label: "Activo" };
    case "SETTLED":
      return { tone: "success", label: "Pagado" };
    case "DEFAULTED":
      return { tone: "danger", label: "En mora" };
    case "CANCELLED":
      return { tone: "warning", label: "Cancelado" };
  }
}
