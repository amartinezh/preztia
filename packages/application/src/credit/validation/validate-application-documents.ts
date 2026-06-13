import type {
  CnpjRegistryRecord,
  RequiredDocumentType,
  ValidationAlert,
} from "@preztiaos/domain";
import {
  alerta,
  crossCheckAddressAgainstCep,
  crossCheckBusinessAgainstRegistry,
  crossCheckDocumentCoherence,
  crossCheckIdentityAgainstCpfRegistry,
  crossCheckPhoneDddAgainstUf,
  crossCheckUtilityIssuerAgainstRegistry,
  extractBrazilianDdd,
  isValidCnpj,
  isValidCpf,
  isWellFormedCep,
  onlyDigits,
  REQUESTED_DOCUMENTS,
  reviewBusinessDocument,
  reviewFileMetadata,
  reviewIdentityDocument,
  reviewUtilityReceipt,
  scoreValidation,
} from "@preztiaos/domain";
import {
  mapBusinessFields,
  mapIdentityFields,
  mapUtilityFields,
} from "./extraction-fields";
import type {
  CepLookup,
  CnpjRegistryLookup,
  CpfRegistryVerifier,
  DddLookup,
  DocumentExtractionReader,
  DocumentValidationAlert,
  DocumentValidationReport,
  PersistedDocumentExtraction,
  ValidationReportRepository,
} from "./ports";

/** Solicitud a validar (se dispara al lograr la completitud documental). */
export interface ValidateApplicationDocumentsCommand {
  readonly tenantId: string;
  readonly applicationId: string;
}

/**
 * Caso de uso: pipeline de validación documental antifraude de una solicitud.
 *
 * Orquesta, sobre las extracciones ya persistidas (Etapa 1):
 * - Etapa 2 — reglas locales: dígitos verificadores, coherencia de fechas,
 *   línea digitable FEBRABAN, forense de metadata y cruce entre documentos.
 * - Etapa 3 — fuentes públicas gratuitas: Receita Federal (CNPJ), catálogo
 *   postal (CEP) y DDD; cada fuente caída degrada a una alerta BAJA, no bloquea.
 * - Etapa 4 — opcional: CPF contra la base RFB (Serpro) si está configurado.
 *
 * El resultado (alertas + score + veredicto) se persiste append-only y se
 * devuelve. Las reglas viven en el dominio; aquí solo se coordinan puertos.
 */
export class ValidateApplicationDocumentsHandler {
  constructor(
    private readonly extractions: DocumentExtractionReader,
    private readonly cnpjRegistry: CnpjRegistryLookup,
    private readonly ceps: CepLookup,
    private readonly ddds: DddLookup,
    private readonly cpfRegistry: CpfRegistryVerifier,
    private readonly reports: ValidationReportRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    cmd: ValidateApplicationDocumentsCommand,
  ): Promise<DocumentValidationReport> {
    const extractions = await this.extractions.findLatestByApplication(cmd);
    const hoy = this.clock();
    const alerts: DocumentValidationAlert[] = [];
    const sources = new Set<string>();

    const byType = new Map(extractions.map((e) => [e.documentType, e]));
    for (const documentType of REQUESTED_DOCUMENTS) {
      if (!byType.has(documentType)) {
        alerts.push({
          documento: documentType,
          ...alerta(
            "extraccion",
            "MEDIA",
            "no hay extracción de IA disponible para este documento: requiere revisión manual",
          ),
        });
      }
    }

    const identityExtraction = byType.get("IDENTITY_DOCUMENT");
    const businessExtraction = byType.get("BUSINESS_VALIDITY_CERTIFICATE");
    const utilityExtraction = byType.get("PUBLIC_SERVICES_RECEIPT");

    const identity = identityExtraction ? mapIdentityFields(identityExtraction.fields) : null;
    const business = businessExtraction ? mapBusinessFields(businessExtraction.fields) : null;
    const utility = utilityExtraction ? mapUtilityFields(utilityExtraction.fields) : null;

    // ── Etapa 2: reglas locales por documento + forense de archivo ──
    if (identity && identityExtraction) {
      tag(alerts, "IDENTITY_DOCUMENT", reviewIdentityDocument(identity, hoy));
      tag(alerts, "IDENTITY_DOCUMENT", reviewFileMetadata(identityExtraction.fileMetadata));
    }
    if (business && businessExtraction) {
      tag(alerts, "BUSINESS_VALIDITY_CERTIFICATE", reviewBusinessDocument(business));
      tag(
        alerts,
        "BUSINESS_VALIDITY_CERTIFICATE",
        reviewFileMetadata(businessExtraction.fileMetadata),
      );
    }
    if (utility && utilityExtraction) {
      tag(alerts, "PUBLIC_SERVICES_RECEIPT", reviewUtilityReceipt(utility, hoy));
      tag(alerts, "PUBLIC_SERVICES_RECEIPT", reviewFileMetadata(utilityExtraction.fileMetadata));
    }

    // ── Etapa 3: registro oficial del CNPJ del negocio (Minha Receita/RFB) ──
    let businessRegistry: CnpjRegistryRecord | null = null;
    if (business?.cnpj && isValidCnpj(business.cnpj)) {
      const lookup = await this.lookupCnpj(onlyDigits(business.cnpj), alerts, sources);
      if (lookup.available) {
        businessRegistry = lookup.record;
        if (lookup.record) {
          tag(
            alerts,
            "BUSINESS_VALIDITY_CERTIFICATE",
            crossCheckBusinessAgainstRegistry(business, lookup.record, hoy),
          );
        } else {
          // La fuente respondió y el CNPJ NO existe: documento de un negocio inexistente.
          tag(alerts, "BUSINESS_VALIDITY_CERTIFICATE", [
            alerta("cnpj", "CRITICA", "el CNPJ del documento no existe en la Receita Federal"),
          ]);
        }
      }
    }

    // ── Etapa 3: emisor del recibo de servicio público ──
    if (utility?.cnpjEmisor && isValidCnpj(utility.cnpjEmisor)) {
      const lookup = await this.lookupCnpj(onlyDigits(utility.cnpjEmisor), alerts, sources);
      if (lookup.available) {
        if (lookup.record) {
          tag(
            alerts,
            "PUBLIC_SERVICES_RECEIPT",
            crossCheckUtilityIssuerAgainstRegistry(lookup.record),
          );
        } else {
          tag(alerts, "PUBLIC_SERVICES_RECEIPT", [
            alerta(
              "cnpj_emissor",
              "CRITICA",
              "el CNPJ del emisor del recibo no existe en la Receita Federal",
            ),
          ]);
        }
      }
    }

    // ── Etapa 3: dirección del recibo contra el catálogo postal ──
    if (utility?.cep && isWellFormedCep(utility.cep)) {
      await this.crossCheckCep(
        { cep: utility.cep, ciudad: utility.ciudad, uf: utility.uf },
        alerts,
        sources,
      );
    }

    // ── Etapa 3: DDD del teléfono del solicitante vs UF de los documentos ──
    const applicantPhone = identityExtraction?.applicantPhone ?? utilityExtraction?.applicantPhone;
    const documentUf = utility?.uf ?? business?.uf ?? null;
    if (applicantPhone && documentUf) {
      await this.crossCheckDdd(applicantPhone, documentUf, alerts, sources);
    }

    // ── Etapa 2/3: coherencia entre documentos (con el QSA oficial si lo hay) ──
    tag(alerts, "CRUCE", crossCheckDocumentCoherence({
      identidadNombre: identity?.nombre ?? null,
      titularRecibo: utility?.titular ?? null,
      sociosNegocio: businessRegistry?.socios ?? business?.socios ?? [],
    }));

    // ── Etapa 4 (opcional): CPF contra la base RFB vía Serpro ──
    if (identity?.cpf && isValidCpf(identity.cpf)) {
      await this.crossCheckCpf(identity.cpf, identity, alerts, sources);
    }

    const verdict = scoreValidation(alerts);
    const report: DocumentValidationReport = {
      tenantId: cmd.tenantId,
      applicationId: cmd.applicationId,
      status: verdict.status,
      score: verdict.score,
      alerts,
      consultedSources: [...sources],
    };
    await this.reports.save(report);
    return report;
  }

  // Consulta tolerante a fallos: distingue "la fuente respondió y el CNPJ no
  // existe" (señal de fraude) de "la fuente está caída" (alerta BAJA, se sigue).
  private async lookupCnpj(
    cnpj: string,
    alerts: DocumentValidationAlert[],
    sources: Set<string>,
  ): Promise<
    | { readonly available: true; readonly record: CnpjRegistryRecord | null }
    | { readonly available: false }
  > {
    try {
      const record = await this.cnpjRegistry.findByCnpj(cnpj);
      sources.add(CNPJ_SOURCE);
      return { available: true, record };
    } catch {
      tag(alerts, "CRUCE", [unavailableSource("registro CNPJ (Minha Receita/BrasilAPI)")]);
      return { available: false };
    }
  }

  private async crossCheckCep(
    declarado: { cep: string; ciudad: string | null; uf: string | null },
    alerts: DocumentValidationAlert[],
    sources: Set<string>,
  ): Promise<void> {
    try {
      const record = await this.ceps.findByCep(onlyDigits(declarado.cep));
      sources.add("cep");
      tag(alerts, "PUBLIC_SERVICES_RECEIPT", crossCheckAddressAgainstCep(declarado, record));
    } catch {
      tag(alerts, "CRUCE", [unavailableSource("catálogo postal (BrasilAPI/ViaCEP)")]);
    }
  }

  private async crossCheckDdd(
    applicantPhone: string,
    documentUf: string,
    alerts: DocumentValidationAlert[],
    sources: Set<string>,
  ): Promise<void> {
    const ddd = extractBrazilianDdd(applicantPhone);
    if (!ddd) return;
    try {
      const record = await this.ddds.findByDdd(ddd);
      sources.add("ddd");
      if (record) {
        tag(
          alerts,
          "CRUCE",
          crossCheckPhoneDddAgainstUf({ ddd, dddState: record.state, documentUf }),
        );
      }
    } catch {
      tag(alerts, "CRUCE", [unavailableSource("catálogo DDD (BrasilAPI)")]);
    }
  }

  private async crossCheckCpf(
    cpf: string,
    identity: ReturnType<typeof mapIdentityFields>,
    alerts: DocumentValidationAlert[],
    sources: Set<string>,
  ): Promise<void> {
    try {
      const record = await this.cpfRegistry.verify(onlyDigits(cpf));
      if (!record) return; // servicio no contratado: el pipeline sigue sin esta señal
      sources.add("cpf-rfb");
      tag(alerts, "IDENTITY_DOCUMENT", crossCheckIdentityAgainstCpfRegistry(identity, record));
    } catch {
      tag(alerts, "CRUCE", [unavailableSource("verificación CPF (Serpro)")]);
    }
  }
}

const CNPJ_SOURCE = "cnpj-rfb";

/** Atribuye alertas del dominio al documento que las originó. */
function tag(
  into: DocumentValidationAlert[],
  documento: RequiredDocumentType | "CRUCE",
  alerts: readonly ValidationAlert[],
): void {
  for (const alert of alerts) into.push({ documento, ...alert });
}

/** Fuente externa caída: se registra sin bloquear (disponibilidad/resiliencia). */
function unavailableSource(nombre: string): ValidationAlert {
  return alerta(
    "fuente_externa",
    "BAJA",
    `no se pudo consultar la fuente externa: ${nombre}; la validación continuó sin esa señal`,
  );
}
