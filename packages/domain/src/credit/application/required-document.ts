// Catálogo de documentos del proceso KYC de una solicitud de crédito.
//
// `RequiredDocumentType` es la TOTALIDAD de documentos que el negocio puede llegar
// a exigir. `REQUESTED_DOCUMENTS` es el subconjunto por defecto: el set inicial que
// se siembra para un tenant. En tiempo de ejecución, el conjunto, su orden y los
// textos que ve el usuario provienen del catálogo configurable por tenant
// (ver `RequiredDocumentSpec`), no de constantes de código.

/** Totalidad de documentos que el proceso KYC puede exigir (presentes y futuros). */
export type RequiredDocumentType =
  | "IDENTITY_DOCUMENT"
  | "BUSINESS_VALIDITY_CERTIFICATE"
  | "PUBLIC_SERVICES_RECEIPT"
  | "BANK_STATEMENT" // futuro: aún no se solicita
  | "INCOME_PROOF"; // futuro: aún no se solicita

/**
 * Especificación de un documento requerido tal como la configura el tenant: la
 * llave estable (identidad técnica), el título que el chat muestra para pedirlo y
 * la descripción con la que la IA puede identificar de qué documento se trata.
 */
export interface RequiredDocumentSpec {
  readonly key: RequiredDocumentType;
  /** Texto que aparece en el chat para solicitar el documento al usuario. */
  readonly title: string;
  /** Descripción suficiente para que la IA identifique el documento recibido. */
  readonly description: string;
}

/**
 * Documentos que se solicitan por defecto, EN ORDEN. Es el set inicial con el que se
 * siembra un tenant; el catálogo en BD puede ampliarlo o reordenarlo sin tocar código.
 */
export const REQUESTED_DOCUMENTS = [
  "IDENTITY_DOCUMENT",
  "BUSINESS_VALIDITY_CERTIFICATE",
  "PUBLIC_SERVICES_RECEIPT",
] as const satisfies readonly RequiredDocumentType[];

/** Devuelve la especificación de un documento por su llave, o undefined si no está. */
export function findDocumentSpec(
  specs: readonly RequiredDocumentSpec[],
  key: RequiredDocumentType,
): RequiredDocumentSpec | undefined {
  return specs.find((spec) => spec.key === key);
}
