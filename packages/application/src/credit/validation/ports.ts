import type {
  CepRecord,
  CnpjRegistryRecord,
  CpfRegistryRecord,
  FileTechnicalMetadata,
  FraudStatus,
  RequiredDocumentType,
  ValidationAlert,
} from "@preztiaos/domain";

// Puertos de salida del pipeline de validación documental antifraude
// (Etapa 2 local + Etapa 3 fuentes públicas + Etapa 4 opcional). La
// infraestructura provee Drizzle y los clientes HTTP de las APIs libres.

/** Extracción persistida de un documento (Etapa 1), insumo de las reglas. */
export interface PersistedDocumentExtraction {
  readonly documentType: RequiredDocumentType;
  /** Teléfono del solicitante (E.164 sin '+') que envió el documento. */
  readonly applicantPhone: string;
  /** Campos extraídos por la IA (clave-valor, no estructurados). */
  readonly fields: Record<string, unknown>;
  /** Metadata técnica del archivo (forense), si se pudo extraer. */
  readonly fileMetadata: FileTechnicalMetadata | null;
}

/** Puerto: lee la extracción MÁS RECIENTE de cada documento de la solicitud. */
export interface DocumentExtractionReader {
  findLatestByApplication(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<readonly PersistedDocumentExtraction[]>;
}

/** Puerto: registro oficial del CNPJ (Minha Receita / BrasilAPI; fuente RFB). */
export interface CnpjRegistryLookup {
  /** null cuando el CNPJ no existe en la fuente. */
  findByCnpj(cnpj: string): Promise<CnpjRegistryRecord | null>;
}

/** Puerto: catálogo postal (BrasilAPI CEP / ViaCEP). */
export interface CepLookup {
  /** null cuando el CEP no existe. */
  findByCep(cep: string): Promise<CepRecord | null>;
}

/** Puerto: estado al que pertenece un DDD telefónico (BrasilAPI). */
export interface DddLookup {
  /** null cuando el DDD no existe. */
  findByDdd(ddd: string): Promise<{ readonly state: string } | null>;
}

/**
 * Puerto: verificación del CPF contra la base de la Receita Federal (Serpro,
 * Etapa 4 — opcional). `null` significa "servicio no contratado/configurado":
 * el pipeline sigue sin esa señal (degradación elegante, nunca bloquea).
 */
export interface CpfRegistryVerifier {
  verify(cpf: string): Promise<CpfRegistryRecord | null>;
}

/** Alerta del reporte, atribuida al documento que la originó. */
export interface DocumentValidationAlert extends ValidationAlert {
  /** Documento que disparó la alerta, o "CRUCE" si nace de comparar varios. */
  readonly documento: RequiredDocumentType | "CRUCE";
}

/** Reporte final del pipeline para una solicitud (se persiste append-only). */
export interface DocumentValidationReport {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly status: FraudStatus;
  /** Riesgo agregado 0..100; mayor = más riesgo. */
  readonly score: number;
  readonly alerts: readonly DocumentValidationAlert[];
  /** Fuentes externas que SÍ respondieron (trazabilidad de la Etapa 3/4). */
  readonly consultedSources: readonly string[];
}

/** Puerto: persistencia del reporte de validación (append-only, bajo RLS). */
export interface ValidationReportRepository {
  save(report: DocumentValidationReport): Promise<void>;
}
