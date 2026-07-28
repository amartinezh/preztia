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
  | "BUSINESS_PHOTO" // foto de la fachada/interior del negocio (análisis antifraude por visión)
  | "PUBLIC_SERVICES_RECEIPT"
  | "BANK_STATEMENT" // futuro: aún no se solicita
  | "INCOME_PROOF"; // futuro: aún no se solicita

/**
 * Cuántos archivos componen un documento cuando el catálogo no lo especifica.
 * Un solo archivo es el caso habitual; el anverso/reverso de una cédula son dos.
 */
export const DEFAULT_EXPECTED_FILES = 1;

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
  /**
   * Cuántos archivos componen el documento (p. ej. 2 = anverso y reverso). El protocolo
   * no da el documento por completo hasta reunirlos todos: pedir "ambos lados" con un
   * solo cupo de archivo es lo que hacía que la segunda foto se juzgara contra el
   * documento siguiente y gastara un intento.
   */
  readonly expectedFiles: number;
}

/**
 * Documentos que se solicitan por defecto, EN ORDEN. Es el set inicial con el que se
 * siembra un tenant; el catálogo en BD puede ampliarlo o reordenarlo sin tocar código.
 */
export const REQUESTED_DOCUMENTS = [
  "IDENTITY_DOCUMENT",
  "BUSINESS_VALIDITY_CERTIFICATE",
  "BUSINESS_PHOTO", // se pide inmediatamente después del certificado de comercio
  "PUBLIC_SERVICES_RECEIPT",
] as const satisfies readonly RequiredDocumentType[];

/** Devuelve la especificación de un documento por su llave, o undefined si no está. */
export function findDocumentSpec(
  specs: readonly RequiredDocumentSpec[],
  key: RequiredDocumentType,
): RequiredDocumentSpec | undefined {
  return specs.find((spec) => spec.key === key);
}

/** Archivos que exige un documento del catálogo; el valor por defecto si no está especificado. */
export function expectedFilesOf(
  specs: readonly RequiredDocumentSpec[],
  key: RequiredDocumentType,
): number {
  return findDocumentSpec(specs, key)?.expectedFiles ?? DEFAULT_EXPECTED_FILES;
}
