/**
 * Desenlace de una conversación de WhatsApp: en qué terminó el contacto de un cliente con el
 * canal. Es la clasificación que la operación necesita para separar el ruido (quien solo
 * preguntó) de lo accionable (quien se quedó a medias, y por culpa de quién).
 */
export type ConversationOutcome =
  | "ONLY_INQUIRY"
  | "TECHNICAL_FAILURE"
  | "INCOMPLETE"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED";

/** Estado del expediente KYC asociado a la conversación (null si nunca abrió solicitud). */
export type ConversationApplicationStatus =
  | "AWAITING_DOCUMENTS"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED";

export interface ConversationOutcomeInput {
  /** Estado de la solicitud más reciente del cliente; null si nunca inició una. */
  readonly applicationStatus: ConversationApplicationStatus | null;
  /** Mensajes que no se pudieron atender por un fallo técnico nuestro. */
  readonly failureCount: number;
}

/**
 * Clasifica una conversación. La precedencia es deliberada:
 *
 *  1. El estado del expediente manda cuando el cliente YA superó el trámite conversacional
 *     (`IN_REVIEW`, `APPROVED`, `REJECTED`): a esas alturas un fallo intermedio ya se
 *     recuperó y no describe el desenlace.
 *  2. Solo si la solicitud NO llegó a completarse, un fallo técnico registrado la explica
 *     (`TECHNICAL_FAILURE`) — incluido el caso de quien ni siquiera pudo abrirla.
 *  3. Sin fallo: hay solicitud a medias (`INCOMPLETE`) o solo hubo consulta (`ONLY_INQUIRY`).
 *
 * Función pura: no conoce SQL, HTTP ni framework. El read model de la bandeja transcribe esta
 * misma precedencia a SQL para poder filtrar y agregar; **esta función es la definición
 * normativa** y es la que produce el valor que se devuelve por el API.
 */
export function classifyConversationOutcome(
  input: ConversationOutcomeInput,
): ConversationOutcome {
  const { applicationStatus, failureCount } = input;
  if (applicationStatus === "APPROVED") return "APPROVED";
  if (applicationStatus === "REJECTED") return "REJECTED";
  if (applicationStatus === "IN_REVIEW") return "PENDING_APPROVAL";
  if (failureCount > 0) return "TECHNICAL_FAILURE";
  if (applicationStatus !== null) return "INCOMPLETE";
  return "ONLY_INQUIRY";
}

/**
 * Una conversación que respalda un crédito APROBADO es evidencia de cómo se originó ese
 * crédito: la bandeja no la borra ni individual ni masivamente.
 */
export function isProtectedFromDeletion(
  applicationStatus: ConversationApplicationStatus | null,
): boolean {
  return applicationStatus === "APPROVED";
}
