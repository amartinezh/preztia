import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import {
  buildSchedule,
  createCreditApplication,
  formatMoneyMinor,
  Money,
  recordDocumentResult,
  scheduleDueDates,
  type CreditApplication,
  type FraudStatus,
  type RequiredDocumentType,
} from '@preztiaos/domain';
import { after, chatIn, chatOut, mediaId, type MessageKind } from './chat';
import type { TenantContext } from './context';
import {
  CITIES,
  formatCpf,
  generateCnpj,
  generateCpf,
  jitterLocation,
  testPhone,
} from './fake-data';
import { documentPdf, PDF_MIME, PNG_MIME, storefrontPng } from './files';
import type {
  BorrowerState,
  BoxState,
  CreditState,
  Row,
  UserRef,
  ZoneRef,
} from './model';
import {
  APPLICATION_DISBURSEMENT_REASON,
  createBorrower,
  grantCredit,
} from './portfolio';

// ORIGINACIÓN por chat: solicitud de crédito con KYC (documentos, extracción por IA, antifraude
// estructural y documental), ubicación, negociación del plan y decisión manual. Espejo de
// `CreditApplicationDrizzleRepository`, `DrizzleValidationReportRepository`, `PlanOfferRepository`,
// `PlanReplyRepository` y `ApplicationDecisionRepository`; el estado de cada documento lo decide la
// regla del dominio `recordDocumentResult`.

const AI_MODEL = 'gemini-2.5-flash';
const DECISION_EVENT = 'MANUAL_REVIEW_DECISION';
const REUSED_DOCUMENT_REASON = 'el documento ya fue usado en otra solicitud';
const REUSED_DOCUMENT_SCORE = 60;
const HIGH_CONFIDENCE = 94;
const LOW_CONFIDENCE = 38;

export type OfferStage =
  | 'NOT_OFFERED'
  | 'AWAITING_SELECTION'
  | 'AWAITING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED';

export interface ApplicationSpec {
  readonly zone: ZoneRef;
  /** Cuántos documentos del checklist llegan completos ('ID_HALF' = solo el anverso). */
  readonly docs: 'NONE' | 'ID_HALF' | 'ONE' | 'TWO' | 'ALL';
  readonly requestedMinor: number | null;
  readonly location: boolean;
  /** Un envío que la IA no reconoce como el documento esperado (intento fallido). */
  readonly mismatch?: boolean;
  /** Documento aceptado por insistencia: queda para revisión manual del analista. */
  readonly manualReview?: boolean;
  /** Un documento ya usado en otra solicitud (antifraude estructural: sospechoso). */
  readonly reusedDocument?: boolean;
  readonly verdict?: FraudStatus;
  /** Re-estudio: primero un veredicto peor y luego el vigente (historial append-only). */
  readonly rerun?: boolean;
  readonly visionRisk?: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly offer?: OfferStage;
  readonly planKey?: string;
  readonly principalMinor?: number;
  readonly decision?: 'APPROVE' | 'OVERRIDE' | 'REJECT';
  readonly rejectionReason?: string;
  readonly failure?: {
    stage:
      | 'DOCUMENT_INTAKE'
      | 'ASSISTANT_REPLY'
      | 'AUDIO_INTAKE'
      | 'LOCATION_CAPTURE';
    kind: MessageKind;
    error: string;
  };
  readonly viaTelegram?: boolean;
  readonly reviewer: UserRef;
  readonly fundingBox?: BoxState;
  readonly collector?: UserRef | null;
}

export interface ApplicationResult {
  readonly applicationId: string;
  readonly phone: string;
  readonly borrower: BorrowerState | null;
  readonly credit: CreditState | null;
}

interface Applicant {
  readonly first: string;
  readonly last: string;
  readonly cpf: string;
  readonly cnpj: string;
  readonly birth: string;
  readonly phone: string;
  readonly channelId: string;
  readonly zone: ZoneRef;
}

/** Corre una solicitud completa dentro del día (los instantes salen de su línea de tiempo). */
export async function runApplication(
  ctx: TenantContext,
  spec: ApplicationSpec,
  date: string,
  startHour: number,
): Promise<ApplicationResult> {
  // Los pasos de la solicitud no tocan cajas salvo el desembolso (una salida): usan instantes
  // propios para no empujar la agenda del resto del día.
  const timeline = {
    at: (hour: number, minute = 0) => ctx.clock.instant(date, hour, minute),
  };
  const applicant = newApplicant(ctx, spec);
  const t0 = timeline.at(startHour, 0);
  greet(ctx, applicant, t0);

  const applicationId = randomUUID();
  let app: CreditApplication = createCreditApplication(
    ctx.scenario.documents
      .filter((d) => d.active ?? true)
      .map((d) => ({ type: d.key, expectedFiles: d.expectedFiles ?? 1 })),
  );
  const row: Row<typeof schema.creditApplication> = {
    id: applicationId,
    tenantId: ctx.tenantId,
    channelId: applicant.channelId,
    applicantPhone: applicant.phone,
    zonePath: ctx.zonePathByChannel.get(applicant.channelId) ?? null,
    status: app.status,
    requestedAmountMinor: null,
    planOffer: 'NOT_OFFERED',
    offeredPlanId: null,
    offeredPrincipalMinor: null,
    offerExpiresAt: null,
    clientAcceptedAt: null,
    latitude: null,
    longitude: null,
    locationSharedAt: null,
    createdAt: t0,
    updatedAt: t0,
  };
  ctx.batch.track(schema.creditApplication, row);
  const docRows = new Map<
    RequiredDocumentType,
    Row<typeof schema.creditApplicationDocument>
  >();
  for (const doc of app.documents) {
    const docRow: Row<typeof schema.creditApplicationDocument> = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      applicationId,
      documentType: doc.type,
      status: doc.status,
      expectedFiles: doc.expectedFiles,
      receivedFiles: doc.receivedFiles,
      mismatchAttempts: doc.mismatchAttempts,
      mediaId: null,
      storageKey: null,
      mimeType: null,
      sha256: null,
      fraudScore: null,
      fraudReasons: null,
      manualReview: false,
      createdAt: t0,
      updatedAt: t0,
    };
    docRows.set(doc.type, docRow);
    ctx.batch.track(schema.creditApplicationDocument, docRow);
  }
  appEvent(
    ctx,
    applicationId,
    'APPLICATION_CREATED',
    { documents: app.documents.map((d) => d.type) },
    t0,
  );
  ctx.stats.applications += 1;

  if (spec.requestedMinor !== null)
    captureAmount(
      ctx,
      applicant,
      row,
      spec.requestedMinor,
      timeline.at(startHour, 3),
    );
  const filesToSend = filesFor(spec, app);
  let minute = 6;
  for (const step of filesToSend) {
    minute += 4;
    app = await sendFile(ctx, {
      applicant,
      applicationId,
      app,
      docRows,
      step,
      spec,
      at: timeline.at(startHour, minute),
    });
    row.status = app.status;
    row.updatedAt = timeline.at(startHour, minute);
  }
  if (spec.failure)
    recordFailure(
      ctx,
      applicant,
      spec.failure,
      timeline.at(startHour, minute + 2),
    );
  if (spec.location)
    shareLocation(ctx, applicant, row, timeline.at(startHour, minute + 3));

  if (app.status === 'IN_REVIEW') {
    const done = timeline.at(startHour, minute + 4);
    chatOut(ctx, {
      phone: applicant.phone,
      channelId: applicant.channelId,
      body: ctx.messages.application.completed,
      at: done,
    });
    runValidation(ctx, applicationId, spec, done);
  }
  const offerAt = timeline.at(startHour + 1, 10);
  if (spec.offer && spec.offer !== 'NOT_OFFERED')
    negotiate(ctx, { applicant, row, spec, at: offerAt, timeline, startHour });

  if (spec.decision === 'REJECT') {
    reject(ctx, row, spec, timeline.at(startHour + 2, 0));
    return {
      applicationId,
      phone: applicant.phone,
      borrower: null,
      credit: null,
    };
  }
  if (spec.decision === 'APPROVE' || spec.decision === 'OVERRIDE') {
    const approved = approve(ctx, {
      applicant,
      row,
      spec,
      at: timeline.at(startHour + 2, 0),
    });
    return { applicationId, phone: applicant.phone, ...approved };
  }
  return {
    applicationId,
    phone: applicant.phone,
    borrower: null,
    credit: null,
  };
}

function newApplicant(ctx: TenantContext, spec: ApplicationSpec): Applicant {
  const city = spec.zone.city ?? CITIES.divinopolis!;
  const brazil = ctx.scenario.countryCode === 'BR';
  const first = ctx.random.pick(
    brazil
      ? [
          'Rosângela',
          'Edson',
          'Cristiane',
          'Wagner',
          'Luana',
          'Maurício',
          'Silvana',
          'Ademir',
          'Kátia',
          'Reginaldo',
          'Michele',
          'Jeferson',
          'Elisângela',
          'Rodrigo',
        ]
      : ['Yolanda', 'Fredy', 'Marleny', 'Wilson', 'Liliana', 'Jhon'],
  );
  const last = ctx.random.pick(
    brazil
      ? [
          'Aparecida Souza',
          'Batista Lima',
          'Ferreira Gomes',
          'Pires Moreira',
          'Rezende Costa',
          'Matos Ribeiro',
          'Coelho Araújo',
        ]
      : ['Cano Ríos', 'Salazar Toro', 'Agudelo Mesa'],
  );
  const telegram = spec.viaTelegram && ctx.telegramChannel;
  const channelId = telegram ? ctx.telegramChannel! : ctx.channelFor(spec.zone);
  const channelZonePath = ctx.zonePathByChannel.get(channelId);
  const zone =
    [...ctx.zones.values()].find((z) => z.path === channelZonePath) ??
    spec.zone;
  return {
    first,
    last,
    cpf: generateCpf(ctx.random),
    cnpj: generateCnpj(ctx.random),
    birth: `${String(ctx.random.int(1, 28)).padStart(2, '0')}/${String(ctx.random.int(1, 12)).padStart(2, '0')}/${ctx.random.int(1968, 2001)}`,
    phone: testPhone(city, ctx.nextPhoneSequence()),
    channelId,
    zone,
  };
}

function greet(ctx: TenantContext, a: Applicant, at: Date): void {
  chatIn(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    kind: 'text',
    body:
      ctx.scenario.language === 'es'
        ? 'Hola, quiero un préstamo para mi negocio'
        : 'Olá! Quero um empréstimo para o meu negócio',
    at,
  });
  chatOut(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    body: ctx.messages.application.intro,
    at: after(at, 3),
  });
  chatOut(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    body: ctx.messages.application.amountQuestion,
    at: after(at, 4),
  });
}

function captureAmount(
  ctx: TenantContext,
  a: Applicant,
  row: Row<typeof schema.creditApplication>,
  amount: number,
  at: Date,
): void {
  chatIn(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    kind: 'text',
    body: formatMoneyMinor(amount, ctx.currency),
    at,
  });
  row.requestedAmountMinor = amount;
  row.updatedAt = at;
  chatOut(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    body: ctx.messages.application.amountOk,
    at: after(at, 3),
  });
}

interface FileStep {
  readonly type: RequiredDocumentType;
  readonly accepted: boolean;
}

/** Archivos que manda el solicitante, en el orden del protocolo (incluye el intento fallido). */
function filesFor(spec: ApplicationSpec, app: CreditApplication): FileStep[] {
  const docsToComplete = {
    NONE: 0,
    ID_HALF: 0,
    ONE: 1,
    TWO: 2,
    ALL: app.documents.length,
  }[spec.docs];
  const steps: FileStep[] = [];
  if (spec.docs === 'ID_HALF')
    return [{ type: 'IDENTITY_DOCUMENT', accepted: true }];
  // Con el checklist incompleto, el intento fallido es el ÚLTIMO envío (documento REJECTED a la
  // espera de un reenvío); completo, ocurre a mitad y el reenvío correcto lo valida.
  const trailingMismatch =
    spec.mismatch && docsToComplete < app.documents.length;
  app.documents.slice(0, docsToComplete).forEach((doc, index) => {
    if (spec.mismatch && !trailingMismatch && index === 1)
      steps.push({ type: doc.type, accepted: false });
    for (let slot = 0; slot < doc.expectedFiles; slot++)
      steps.push({ type: doc.type, accepted: true });
  });
  if (trailingMismatch)
    steps.push({ type: app.documents[docsToComplete]!.type, accepted: false });
  return steps;
}

async function sendFile(
  ctx: TenantContext,
  input: {
    applicant: Applicant;
    applicationId: string;
    app: CreditApplication;
    docRows: Map<
      RequiredDocumentType,
      Row<typeof schema.creditApplicationDocument>
    >;
    step: FileStep;
    spec: ApplicationSpec;
    at: Date;
  },
): Promise<CreditApplication> {
  const { applicant, step, at } = input;
  const docRow = input.docRows.get(step.type)!;
  const photo = step.type === 'BUSINESS_PHOTO';
  const media = mediaId(ctx);
  const mimeType = photo || !step.accepted ? PNG_MIME : PDF_MIME;
  chatIn(ctx, {
    phone: applicant.phone,
    channelId: applicant.channelId,
    kind: photo ? 'image' : 'document',
    body: null,
    mediaId: media,
    mimeType,
    at,
  });

  const app = recordDocumentResult(input.app, step.type, step.accepted);
  const doc = app.documents.find((d) => d.type === step.type)!;
  const slot = doc.receivedFiles;
  const manualReview = Boolean(
    input.spec.manualReview && step.type === 'PUBLIC_SERVICES_RECEIPT',
  );
  const reused = Boolean(
    input.spec.reusedDocument && step.type === 'BUSINESS_VALIDITY_CERTIFICATE',
  );
  extraction(ctx, input, media, at);
  if (step.accepted) {
    const base = `${ctx.tenantId}/${input.applicationId}/${step.type}`;
    const key = slot > 1 ? `${base}/${slot}` : base;
    const file = await ctx.files.put(
      key,
      documentBytes(ctx, applicant, step.type, slot),
      mimeType,
    );
    ctx.batch.insert(schema.creditApplicationDocumentFile, {
      tenantId: ctx.tenantId,
      applicationId: input.applicationId,
      documentType: step.type,
      slot,
      mediaId: media,
      storageKey: file.storageKey ?? key,
      mimeType,
      sha256: file.sha256,
      createdAt: at,
    });
    if (slot === 1)
      Object.assign(docRow, {
        mediaId: media,
        storageKey: file.storageKey,
        mimeType,
        sha256: file.sha256,
      });
  }
  Object.assign(docRow, {
    status: doc.status,
    receivedFiles: doc.receivedFiles,
    mismatchAttempts: doc.mismatchAttempts,
    fraudScore: reused ? REUSED_DOCUMENT_SCORE : 0,
    fraudReasons: reused ? [REUSED_DOCUMENT_REASON] : [],
    manualReview,
    updatedAt: at,
  });
  appEvent(
    ctx,
    input.applicationId,
    'DOCUMENT_RECORDED',
    {
      documentType: step.type,
      documentStatus: doc.status,
      receivedFiles: doc.receivedFiles,
      expectedFiles: doc.expectedFiles,
      mismatchAttempts: doc.mismatchAttempts,
      fraudStatus: reused ? 'suspicious' : 'approved',
      fraudScore: reused ? REUSED_DOCUMENT_SCORE : 0,
      manualReview,
      applicationStatus: app.status,
    },
    at,
  );
  replyToFile(
    ctx,
    applicant,
    app,
    step,
    doc.expectedFiles - doc.receivedFiles,
    manualReview,
    after(at, 5),
  );
  return app;
}

function replyToFile(
  ctx: TenantContext,
  a: Applicant,
  app: CreditApplication,
  step: FileStep,
  missing: number,
  manualReview: boolean,
  at: Date,
): void {
  const m = ctx.messages.application;
  const nextDoc = app.documents.find((d) => d.status !== 'VALIDATED');
  const nextTitle = nextDoc
    ? (ctx.scenario.documents.find((d) => d.key === nextDoc.type)?.title ??
      m.documentFallback(nextDoc.type))
    : null;
  const body = !step.accepted
    ? m.mismatchRetry({
        detected: 'foto de documento pessoal',
        prompt: nextTitle ?? '',
        attemptsLeft: 2,
      })
    : missing > 0
      ? m.remainingFiles(missing)
      : manualReview
        ? m.fileReceivedForManualReview
        : `${m.fileReceived}${nextTitle && app.status !== 'IN_REVIEW' ? `\n\n${nextTitle}` : ''}`;
  chatOut(ctx, { phone: a.phone, channelId: a.channelId, body, at });
}

/** Lo que la IA extrajo del archivo (trazabilidad KYC y base del antifraude documental). */
function extraction(
  ctx: TenantContext,
  input: {
    applicant: Applicant;
    applicationId: string;
    step: FileStep;
    spec: ApplicationSpec;
  },
  media: string,
  at: Date,
): void {
  const { applicant, step } = input;
  ctx.batch.insert(schema.documentExtraction, {
    tenantId: ctx.tenantId,
    applicationId: input.applicationId,
    documentType: step.type,
    applicantPhone: applicant.phone,
    mediaId: media,
    provider: 'GEMINI',
    model: AI_MODEL,
    identifiedType: step.accepted ? step.type : 'SELFIE',
    matchesExpected: step.accepted,
    confidence: step.accepted ? HIGH_CONFIDENCE : LOW_CONFIDENCE,
    fields: step.accepted
      ? fieldsFor(ctx, applicant, step.type, input.spec)
      : { observacao: 'Foto de rosto (selfie), não é o documento pedido' },
    fileMetadata: {
      producer:
        step.type === 'BUSINESS_PHOTO'
          ? 'Android Camera'
          : 'Microsoft Print to PDF',
      createDate: at.toISOString(),
      modifyDate: at.toISOString(),
    },
    rawText: step.accepted
      ? `${applicant.first} ${applicant.last} ${formatCpf(applicant.cpf)}`
      : null,
    rawResponse: { model: AI_MODEL, finishReason: 'STOP' },
    createdAt: at,
  });
}

function fieldsFor(
  ctx: TenantContext,
  a: Applicant,
  type: RequiredDocumentType,
  spec: ApplicationSpec,
): Record<string, unknown> {
  const city = a.zone.city ?? CITIES.divinopolis!;
  const name = `${a.first} ${a.last}`.toUpperCase();
  switch (type) {
    case 'IDENTITY_DOCUMENT':
      return {
        tipo_documento: 'CNH',
        nome: name,
        cpf: formatCpf(a.cpf),
        data_nascimento: a.birth,
        data_emissao: '15/03/2021',
        validade: '15/03/2031',
        orgao_emissor: `DETRAN/${city.uf}`,
      };
    case 'BUSINESS_VALIDITY_CERTIFICATE':
      return {
        razao_social: `${name} ME`,
        nome_fantasia: `Comércio ${a.first}`,
        cnpj: a.cnpj,
        situacao_cadastral: 'ATIVA',
        capital_social: 'R$ 10.000,00',
        cep: city.cep,
        uf: city.uf,
        municipio: city.name,
        qsa: [{ nome_socio: name }],
      };
    case 'PUBLIC_SERVICES_RECEIPT':
      return {
        titular: name,
        distribuidora: city.uf === 'MG' ? 'CEMIG' : 'Enel SP',
        cnpj_emissor: city.uf === 'MG' ? '06981180000116' : '61695227000193',
        cep: city.cep,
        uf: city.uf,
        mes_referencia: '09/2026',
        valor: 'R$ 187,43',
        vencimento: '10/10/2026',
      };
    case 'BUSINESS_PHOTO':
      return visionFields(spec.visionRisk ?? 'LOW', a);
    default:
      return { observacao: 'Documento complementar' };
  }
}

function visionFields(
  risk: 'LOW' | 'MEDIUM' | 'HIGH',
  a: Applicant,
): Record<string, unknown> {
  const byRisk = {
    LOW: {
      veracityScore: 91,
      matchesRegistry: true,
      inconsistencies: [],
      summary: `Fachada de comércio ativo com letreiro "${a.first}", estoque visível e movimento de clientes.`,
    },
    MEDIUM: {
      veracityScore: 64,
      matchesRegistry: true,
      inconsistencies: [
        'Letreiro com nome diferente do registro',
        'Pouco estoque visível',
      ],
      summary:
        'Local parece funcionar, mas o letreiro não coincide com a razão social.',
    },
    HIGH: {
      veracityScore: 22,
      matchesRegistry: false,
      inconsistencies: [
        'Imagem parece tirada da internet',
        'Sem sinais de atividade comercial',
      ],
      summary: 'A foto não demonstra um negócio em funcionamento.',
    },
  } as const;
  return { riskLevel: risk, ...byRisk[risk] };
}

function documentBytes(
  ctx: TenantContext,
  a: Applicant,
  type: RequiredDocumentType,
  slot: number,
): Buffer {
  const name = `${a.first} ${a.last}`;
  switch (type) {
    case 'BUSINESS_PHOTO':
      return storefrontPng(`Comércio ${a.first}`, [200, 60, 60]);
    case 'IDENTITY_DOCUMENT':
      return documentPdf(
        slot === 1
          ? 'CARTEIRA NACIONAL DE HABILITAÇÃO — FRENTE'
          : 'CARTEIRA NACIONAL DE HABILITAÇÃO — VERSO',
        [
          `Nome: ${name.toUpperCase()}`,
          `CPF: ${formatCpf(a.cpf)}`,
          `Nascimento: ${a.birth}`,
          'Documento de prueba generado por el seed de PreztiaOS',
        ],
      );
    case 'BUSINESS_VALIDITY_CERTIFICATE':
      return documentPdf('COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO CADASTRAL', [
        `CNPJ: ${a.cnpj}`,
        `Nome empresarial: ${name.toUpperCase()} ME`,
        'Situação cadastral: ATIVA',
        'Documento de prueba generado por el seed de PreztiaOS',
      ]);
    default:
      return documentPdf('CONTA DE ENERGIA ELÉTRICA', [
        `Titular: ${name.toUpperCase()}`,
        'Referência: 09/2026',
        'Valor: R$ 187,43',
        'Documento de prueba generado por el seed de PreztiaOS',
      ]);
  }
}

function shareLocation(
  ctx: TenantContext,
  a: Applicant,
  row: Row<typeof schema.creditApplication>,
  at: Date,
): void {
  const city = a.zone.city ?? CITIES.divinopolis!;
  const point = jitterLocation(ctx.random, city);
  chatIn(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    kind: 'location',
    body: `${point.lat},${point.lng}`,
    at,
  });
  Object.assign(row, {
    latitude: point.lat,
    longitude: point.lng,
    locationSharedAt: at,
    updatedAt: at,
  });
  chatOut(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    body: ctx.messages.application.locationReceived,
    at: after(at, 3),
  });
}

function recordFailure(
  ctx: TenantContext,
  a: Applicant,
  failure: NonNullable<ApplicationSpec['failure']>,
  at: Date,
): void {
  const messageId = chatIn(ctx, {
    phone: a.phone,
    channelId: a.channelId,
    kind: failure.kind,
    body: failure.kind === 'text' ? 'Oi? Alguém aí?' : null,
    mediaId: failure.kind === 'text' ? null : mediaId(ctx),
    at,
  });
  ctx.batch.insert(schema.conversationFailure, {
    tenantId: ctx.tenantId,
    channelId: a.channelId,
    applicantPhone: a.phone,
    zonePath: ctx.zonePathByChannel.get(a.channelId) ?? null,
    stage: failure.stage,
    messageKind: failure.kind,
    messageId,
    errorName: 'Error',
    errorMessage: failure.error,
    createdAt: after(at, 2),
  });
}

/** Etapas 2-4 del antifraude documental: reporte append-only + evento en la bitácora. */
function runValidation(
  ctx: TenantContext,
  applicationId: string,
  spec: ApplicationSpec,
  at: Date,
): void {
  const runs: FraudStatus[] = spec.rerun
    ? ['suspicious', spec.verdict ?? 'approved']
    : [spec.verdict ?? 'approved'];
  runs.forEach((status, index) => {
    const report = validationReport(status);
    const runAt = after(at, index * 1800);
    ctx.batch.insert(schema.documentValidation, {
      tenantId: ctx.tenantId,
      applicationId,
      status,
      score: report.score,
      alerts: report.alerts,
      consultedSources: report.sources,
      createdAt: runAt,
    });
    appEvent(
      ctx,
      applicationId,
      'ANTIFRAUD_VALIDATION_COMPLETED',
      {
        status,
        score: report.score,
        alertCount: report.alerts.length,
        consultedSources: report.sources,
      },
      runAt,
    );
  });
}

function validationReport(status: FraudStatus) {
  const sources = ['cnpj-rfb', 'cep', 'ddd'];
  if (status === 'approved') return { score: 0, alerts: [], sources };
  if (status === 'suspicious') {
    return {
      score: 45,
      sources,
      alerts: [
        {
          documento: 'PUBLIC_SERVICES_RECEIPT',
          campo: 'titular',
          severidad: 'ALTA',
          detalle:
            'El titular del recibo no coincide con el nombre del documento de identidad',
        },
        {
          documento: 'CRUCE',
          campo: 'fuente_externa',
          severidad: 'BAJA',
          detalle:
            'no se pudo consultar la fuente externa: verificación CPF (Serpro); la validación continuó sin esa señal',
        },
      ],
    };
  }
  return {
    score: 100,
    sources,
    alerts: [
      {
        documento: 'IDENTITY_DOCUMENT',
        campo: 'cpf',
        severidad: 'CRITICA',
        detalle:
          'El CPF tiene dígitos verificadores inválidos (documento adulterado)',
      },
      {
        documento: 'BUSINESS_VALIDITY_CERTIFICATE',
        campo: 'situacao_cadastral',
        severidad: 'ALTA',
        detalle: 'La Receita reporta el CNPJ como BAIXADA',
      },
    ],
  };
}

/** Negociación del plan: oferta, elección/aceptación, rechazo o vencimiento. */
function negotiate(
  ctx: TenantContext,
  input: {
    applicant: Applicant;
    row: Row<typeof schema.creditApplication>;
    spec: ApplicationSpec;
    at: Date;
    timeline: { at: (hour: number, minute?: number) => Date };
    startHour: number;
  },
): void {
  const { applicant, row, spec } = input;
  const plan = ctx.plan(spec.planKey ?? 'd20');
  const principal = spec.principalMinor ?? row.requestedAmountMinor ?? 50000;
  const expired = spec.offer === 'EXPIRED';
  const ttlHours = ctx.settings.planOfferTtlHours;
  const expiresAt = expired
    ? new Date(input.at.getTime() - 3_600_000)
    : new Date(input.at.getTime() + ttlHours * 3_600_000);
  const offeredAt = expired
    ? new Date(expiresAt.getTime() - ttlHours * 3_600_000)
    : input.at;
  const selecting = spec.offer === 'AWAITING_SELECTION';
  Object.assign(row, {
    planOffer: selecting ? 'AWAITING_SELECTION' : 'AWAITING_ACCEPTANCE',
    offeredPlanId: selecting ? null : plan.id,
    offeredPrincipalMinor: principal,
    offerExpiresAt: expiresAt,
    updatedAt: offeredAt,
  });
  appEvent(
    ctx,
    row.id,
    'PLAN_OFFERED',
    {
      to: row.planOffer,
      offeredPlanId: row.offeredPlanId,
      offeredPrincipalMinor: principal,
      offerExpiresAt: expiresAt.toISOString(),
      decidedBy: spec.reviewer.id,
    },
    offeredAt,
  );
  const m = ctx.messages.plan;
  if (selecting) {
    const lines = [...ctx.plans.values()]
      .filter((p) => p.isActive)
      .map(
        (p, i) =>
          `${i + 1}) ${m.planLine({ name: p.name, installments: p.installmentsCount, frequency: m.frequency[p.frequency], interestPct: p.interestPct / 10 })}`,
      );
    chatOut(ctx, {
      phone: applicant.phone,
      channelId: applicant.channelId,
      body: m.menu(lines),
      at: after(offeredAt, 2),
    });
    return;
  }
  chatOut(ctx, {
    phone: applicant.phone,
    channelId: applicant.channelId,
    body: offerText(ctx, plan.key, principal, input.at),
    at: after(offeredAt, 2),
  });
  if (spec.offer === 'ACCEPTED') {
    const acceptedAt = input.timeline.at(input.startHour + 1, 25);
    chatIn(ctx, {
      phone: applicant.phone,
      channelId: applicant.channelId,
      kind: 'text',
      body: 'SIM',
      at: acceptedAt,
    });
    Object.assign(row, {
      planOffer: 'ACCEPTED',
      clientAcceptedAt: acceptedAt,
      updatedAt: acceptedAt,
    });
    appEvent(
      ctx,
      row.id,
      'CLIENT_ACCEPTED',
      { acceptedAt: acceptedAt.toISOString() },
      acceptedAt,
    );
    chatOut(ctx, {
      phone: applicant.phone,
      channelId: applicant.channelId,
      body: m.accepted,
      at: after(acceptedAt, 2),
    });
  } else if (spec.offer === 'DECLINED') {
    const declinedAt = input.timeline.at(input.startHour + 1, 30);
    chatIn(ctx, {
      phone: applicant.phone,
      channelId: applicant.channelId,
      kind: 'text',
      body: 'NÃO',
      at: declinedAt,
    });
    Object.assign(row, { planOffer: 'DECLINED', updatedAt: declinedAt });
    appEvent(ctx, row.id, 'CLIENT_DECLINED', {}, declinedAt);
    chatOut(ctx, {
      phone: applicant.phone,
      channelId: applicant.channelId,
      body: m.declined,
      at: after(declinedAt, 2),
    });
  }
}

function offerText(
  ctx: TenantContext,
  planKey: string,
  principal: number,
  at: Date,
): string {
  const plan = ctx.plan(planKey);
  const schedule = buildSchedule(
    Money.of(principal, ctx.currency),
    plan.interestPct,
    plan.installmentsCount,
  );
  const dates = scheduleDueDates(
    at.toISOString().slice(0, 10),
    plan.frequency,
    plan.installmentsCount,
  );
  const money = (minorUnits: number) =>
    `${ctx.currency} ${Math.round(minorUnits / 100).toLocaleString('es-CO')}`;
  const m = ctx.messages.plan;
  return m.offer({
    principal: money(principal),
    planName: plan.name,
    scheduleRows: schedule.map(
      (i, idx) => `${dates[idx]} — ${money(i.amountDueMinor)}`,
    ),
    total: money(schedule.reduce((acc, i) => acc + i.amountDueMinor, 0)),
    installments: plan.installmentsCount,
    frequency: m.frequency[plan.frequency],
  });
}

function reject(
  ctx: TenantContext,
  row: Row<typeof schema.creditApplication>,
  spec: ApplicationSpec,
  at: Date,
): void {
  const reason = spec.rejectionReason ?? 'Documentación inconsistente';
  Object.assign(row, { status: 'REJECTED', updatedAt: at });
  appEvent(
    ctx,
    row.id,
    DECISION_EVENT,
    { decision: 'REJECT', reason, decidedBy: spec.reviewer.id },
    at,
  );
  ctx.batch.insert(schema.creditApplicationRejection, {
    tenantId: ctx.tenantId,
    applicationId: row.id,
    reason,
    decidedBy: spec.reviewer.id,
    createdAt: at,
  });
}

/**
 * Aprobación: el coordinador registra al cliente con los datos extraídos (OCR), crea el crédito
 * con el plan ofertado y el dinero sale de la caja elegida, todo en el mismo instante.
 */
function approve(
  ctx: TenantContext,
  input: {
    applicant: Applicant;
    row: Row<typeof schema.creditApplication>;
    spec: ApplicationSpec;
    at: Date;
  },
): { borrower: BorrowerState; credit: CreditState } {
  const { applicant, row, spec, at } = input;
  if (!spec.fundingBox) throw new Error('Aprobar exige la caja que desembolsa');
  const borrower = createBorrower(ctx, {
    zone: applicant.zone,
    collector: spec.collector ?? null,
    profile: 'PUNCTUAL',
    at: new Date(at.getTime() - 60_000),
    phone: applicant.phone,
    fullName: { first: applicant.first, last: applicant.last },
  });
  Object.assign(borrower.row, {
    nationalId: applicant.cpf,
    lat: row.latitude ?? borrower.row.lat,
    lng: row.longitude ?? borrower.row.lng,
  });
  const plan = ctx.plan(spec.planKey ?? 'd20');
  const credit = grantCredit(ctx, {
    borrower,
    principalMinor: row.offeredPrincipalMinor ?? spec.principalMinor ?? 50000,
    plan,
    fundingBox: spec.fundingBox,
    grantedBy: spec.reviewer,
    at,
    reason: APPLICATION_DISBURSEMENT_REASON,
  });
  Object.assign(row, { status: 'APPROVED', updatedAt: at });
  appEvent(
    ctx,
    row.id,
    DECISION_EVENT,
    {
      decision: 'APPROVE',
      reason:
        spec.decision === 'OVERRIDE'
          ? 'Cliente confirmó por llamada; se crea sin aceptación por chat'
          : 'Documentación completa y verificada',
      decidedBy: spec.reviewer.id,
      creditId: credit.id,
      ...(spec.decision === 'OVERRIDE' ? { override: true } : {}),
      paymentPlanId: plan.id,
    },
    at,
  );
  const supportPhone =
    ctx.scenario.zones.find((z) => z.path === applicant.zone.path)
      ?.supportPhone ?? null;
  chatOut(ctx, {
    phone: applicant.phone,
    channelId: applicant.channelId,
    body: ctx.messages.credit.registered(supportPhone),
    at: after(at, 5),
  });
  return { borrower, credit };
}

/** Conversación de SOLO consulta (nunca abrió solicitud): preguntas al asistente. */
export function runInquiry(
  ctx: TenantContext,
  input: {
    zone: ZoneRef;
    at: Date;
    questions: readonly string[];
    offTopic?: boolean;
    failure?: string;
  },
): void {
  const city = input.zone.city ?? CITIES.divinopolis!;
  const phone = testPhone(city, ctx.nextPhoneSequence());
  const channelId = ctx.channelFor(input.zone);
  input.questions.forEach((question, i) => {
    const at = after(input.at, i * 90);
    chatIn(ctx, { phone, channelId, kind: 'text', body: question, at });
    chatOut(ctx, {
      phone,
      channelId,
      body:
        input.offTopic && i === input.questions.length - 1
          ? ctx.messages.assistant.offTopic
          : inquiryAnswer(ctx, question),
      at: after(at, 6),
    });
  });
  if (input.failure) {
    const at = after(input.at, input.questions.length * 90 + 30);
    const messageId = chatIn(ctx, {
      phone,
      channelId,
      kind: 'audio',
      body: null,
      mediaId: mediaId(ctx),
      mimeType: 'audio/ogg',
      at,
    });
    ctx.batch.insert(schema.conversationFailure, {
      tenantId: ctx.tenantId,
      channelId,
      applicantPhone: phone,
      zonePath: ctx.zonePathByChannel.get(channelId) ?? null,
      stage: 'AUDIO_INTAKE',
      messageKind: 'audio',
      messageId,
      errorName: 'TypeError',
      errorMessage: input.failure,
      createdAt: after(at, 2),
    });
  }
}

function inquiryAnswer(ctx: TenantContext, question: string): string {
  if (ctx.scenario.language === 'es') {
    return /cuota|plan/i.test(question)
      ? 'Tenemos planes de 20 y 30 cuotas diarias, 6 semanales y 2 mensuales. Para $ 500.000 a 20 cuotas pagas $ 30.000 diarios.'
      : 'Pedimos cédula, certificado del negocio y un recibo de servicios. ¿Quieres iniciar tu solicitud?';
  }
  return /parcela|juros|plano/i.test(question)
    ? 'Temos planos de 11, 20 e 24 parcelas diárias. Para R$ 1.000,00 em 20 parcelas, a parcela é de R$ 60,00.'
    : 'Pedimos documento com foto, comprovante do negócio, foto do local e uma conta de luz. Quer iniciar a solicitação?';
}

function appEvent(
  ctx: TenantContext,
  applicationId: string,
  type: string,
  payload: Record<string, unknown>,
  at: Date,
): void {
  ctx.batch.insert(schema.creditApplicationEvent, {
    tenantId: ctx.tenantId,
    applicationId,
    type,
    payload,
    createdAt: at,
  });
}
