// Catálogo de documentos del proceso KYC de una solicitud de crédito.
//
// `RequiredDocumentType` es la TOTALIDAD de documentos que el negocio puede llegar
// a exigir. `REQUESTED_DOCUMENTS` es el subconjunto ORDENADO que se solicita hoy:
// añadir un documento al flujo es agregarlo a esa lista, sin tocar el resto.

/** Totalidad de documentos que el proceso KYC puede exigir (presentes y futuros). */
export type RequiredDocumentType =
  | "IDENTITY_DOCUMENT"
  | "BUSINESS_VALIDITY_CERTIFICATE"
  | "PUBLIC_SERVICES_RECEIPT"
  | "BANK_STATEMENT" // futuro: aún no se solicita
  | "INCOME_PROOF"; // futuro: aún no se solicita

/**
 * Documentos que se solicitan en la fase actual, EN ORDEN. Es la única fuente del
 * orden del protocolo: el primero pendiente es el siguiente que se pide.
 */
export const REQUESTED_DOCUMENTS = [
  "IDENTITY_DOCUMENT",
  "BUSINESS_VALIDITY_CERTIFICATE",
  "PUBLIC_SERVICES_RECEIPT",
] as const satisfies readonly RequiredDocumentType[];

// Mensajes con los que el asistente pide cada documento (español, aptos para WhatsApp).
const DOCUMENT_PROMPTS: Record<RequiredDocumentType, string> = {
  IDENTITY_DOCUMENT:
    "Para iniciar tu solicitud, envíame una foto clara de tu *documento de identidad* (cédula) por ambos lados.",
  BUSINESS_VALIDITY_CERTIFICATE:
    "Ahora envíame el *certificado de existencia y representación legal* (cámara de comercio) del negocio al que perteneces. Puede ser foto o PDF.",
  PUBLIC_SERVICES_RECEIPT:
    "Por último, envíame un *recibo de servicios públicos* reciente para validar tu dirección. Puede ser foto o PDF.",
  BANK_STATEMENT: "Envíame tu *extracto bancario* de los últimos meses.",
  INCOME_PROOF: "Envíame un *comprobante de ingresos*.",
};

/** Mensaje para solicitar un documento concreto al usuario. */
export function documentPrompt(type: RequiredDocumentType): string {
  return DOCUMENT_PROMPTS[type];
}
