import type { ConversationOutcome } from "@preztiaos/contracts";
import type { BadgeTone } from "@preztiaos/ui";

import type { MessageKey } from "@/core/i18n";

/** "Todas" no es un desenlace: es la ausencia de filtro en la pantalla. */
export const ALL_OUTCOMES = "ALL" as const;
export type OutcomeFilter = ConversationOutcome | typeof ALL_OUTCOMES;

/**
 * Orden de presentación de las categorías: sigue el recorrido del cliente por el embudo
 * (consultó → se quedó a medias → completó → decisión), con la falla técnica destacada al
 * frente porque es la única accionable por el equipo, no por el cliente.
 */
export const OUTCOME_FILTERS: readonly OutcomeFilter[] = [
  ALL_OUTCOMES,
  "TECHNICAL_FAILURE",
  "ONLY_INQUIRY",
  "INCOMPLETE",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
];

const TONE: Record<ConversationOutcome, BadgeTone> = {
  ONLY_INQUIRY: "neutral",
  TECHNICAL_FAILURE: "danger",
  INCOMPLETE: "warning",
  PENDING_APPROVAL: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

export function outcomeTone(outcome: ConversationOutcome): BadgeTone {
  return TONE[outcome];
}

export function outcomeLabelKey(outcome: OutcomeFilter): MessageKey {
  return `inbox.outcome.${outcome}` as MessageKey;
}

export function outcomeHintKey(outcome: OutcomeFilter): MessageKey {
  return `inbox.outcome.hint.${outcome}` as MessageKey;
}
