import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type PaymentAntifraudInput,
  type PaymentAntifraudService,
} from '@preztiaos/application';
import {
  analyzeE2EId,
  isKnownIspb,
  matchReceiver,
  type FraudAssessment,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

const DEFAULT_MAX_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SCORE_REJECTED = 100;
const SCORE_SUSPICIOUS = 60;

/** Resultado parcial de una regla; null si la regla no aplica. */
interface RuleFinding {
  readonly scoreDelta: number;
  readonly reasons: readonly string[];
  /** true si la regla por sí sola rechaza el comprobante. */
  readonly rejects: boolean;
}

/**
 * Regla antifraude de pagos. PUNTO DE EXTENSIÓN del módulo: para ampliar el
 * antifraude se crea una clase nueva que implemente esta interfaz y se registra
 * en `PaymentAntifraudComposite` (vía el módulo). Las reglas no se tocan entre sí.
 */
export interface PaymentFraudRule {
  evaluate(input: PaymentAntifraudInput): Promise<RuleFinding | null>;
}

/** Comprobante reutilizado: el mismo binario (sha256) ya respalda otro pago del tenant. */
export class Sha256ReuseRule implements PaymentFraudRule {
  async evaluate(input: PaymentAntifraudInput): Promise<RuleFinding | null> {
    const reused = await withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.payment.id })
        .from(schema.payment)
        .where(eq(schema.payment.sha256, input.sha256))
        .limit(1);
      return Boolean(row);
    });
    if (!reused) return null;
    return {
      scoreDelta: SCORE_REJECTED,
      reasons: ['El comprobante ya fue presentado para otro pago'],
      rejects: true,
    };
  }
}

/** Transacción PIX duplicada: el end_to_end_id ya está registrado en otro pago. */
export class DuplicateEndToEndRule implements PaymentFraudRule {
  async evaluate(input: PaymentAntifraudInput): Promise<RuleFinding | null> {
    const endToEndId = input.pix?.endToEndId;
    if (!endToEndId) return null;
    const duplicated = await withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.payment.id })
        .from(schema.payment)
        .where(
          and(
            eq(schema.payment.endToEndId, endToEndId),
            isNotNull(schema.payment.endToEndId),
          ),
        )
        .limit(1);
      return Boolean(row);
    });
    if (!duplicated) return null;
    return {
      scoreDelta: SCORE_REJECTED,
      reasons: ['La transacción PIX ya fue reportada en otro pago'],
      rejects: true,
    };
  }
}

/**
 * EndToEndId del PIX mal formado (estructura del Bacen) o de un ISPB no reconocido. La
 * validación de forma es pura (domain `analyzeE2EId`); malformado ⇒ rechazo (bandera roja),
 * ISPB con forma válida pero ausente del registro semilla ⇒ sospecha blanda (registro
 * incompleto, no se rechaza). La ausencia de E2E es sospecha blanda (extracción incompleta).
 */
export class E2EWellFormedRule implements PaymentFraudRule {
  evaluate(input: PaymentAntifraudInput): Promise<RuleFinding | null> {
    const endToEndId = input.pix?.endToEndId;
    if (!endToEndId) {
      return Promise.resolve({
        scoreDelta: SCORE_SUSPICIOUS,
        reasons: ['El comprobante no trae identificador end-to-end (E2E)'],
        rejects: false,
      });
    }
    const analysis = analyzeE2EId(endToEndId);
    if (!analysis.valid) {
      return Promise.resolve({
        scoreDelta: SCORE_REJECTED,
        reasons: [
          `Identificador PIX (E2E) malformado: ${analysis.problems.join('; ')}`,
        ],
        rejects: true,
      });
    }
    if (analysis.ispb && !isKnownIspb(analysis.ispb)) {
      return Promise.resolve({
        scoreDelta: SCORE_SUSPICIOUS,
        reasons: [
          `El ISPB ${analysis.ispb} del E2E no corresponde a una institución reconocida`,
        ],
        rejects: false,
      });
    }
    return Promise.resolve(null);
  }
}

/**
 * El recebedor del comprobante no coincide con NINGUNA cuenta recaudadora activa del tenant
 * (llave PIX o titular): el crédito habría ido a otra cuenta ⇒ rechazo. La comparación es pura
 * (domain `matchReceiver`); aquí solo se cargan las cuentas configuradas. Si no hay nada
 * comparable (cuenta sin identidad o recibo sin recebedor) no concluye y no penaliza.
 */
export class ReceiverMatchRule implements PaymentFraudRule {
  async evaluate(input: PaymentAntifraudInput): Promise<RuleFinding | null> {
    const receiptPixKey = input.pix?.receiverPixKey ?? null;
    const receiptName = input.pix?.receiverName ?? null;
    if (!receiptPixKey && !receiptName) return null;

    const accounts = await withTenantTxFor(input.tenantId, (tx) =>
      tx
        .select({
          pixKey: schema.tenantBankAccount.pixKey,
          receiverName: schema.tenantBankAccount.receiverName,
        })
        .from(schema.tenantBankAccount)
        .where(eq(schema.tenantBankAccount.active, true)),
    );
    if (accounts.length === 0) return null;

    const results = accounts.map((account) =>
      matchReceiver(
        { pixKey: receiptPixKey, name: receiptName },
        { pixKey: account.pixKey, name: account.receiverName },
      ),
    );
    // Coincide con alguna cuenta, o ninguna tenía datos comparables → no penaliza.
    if (results.some((r) => r.matches)) return null;
    if (results.every((r) => r.inconclusive)) return null;

    const reasons = results.find((r) => !r.inconclusive && !r.matches)?.reasons;
    return {
      scoreDelta: SCORE_REJECTED,
      reasons: reasons
        ? [...reasons]
        : ['El recebedor no coincide con ninguna cuenta recaudadora'],
      rejects: true,
    };
  }
}

/** Comprobante demasiado antiguo respecto del momento en que se reporta. */
export class StaleReceiptRule implements PaymentFraudRule {
  evaluate(input: PaymentAntifraudInput): Promise<RuleFinding | null> {
    const paidAt = input.pix?.paidAt;
    if (!paidAt) return Promise.resolve(null);
    const paidTime = Date.parse(paidAt);
    if (Number.isNaN(paidTime)) return Promise.resolve(null);

    const ageDays = (Date.parse(input.receivedAt) - paidTime) / MS_PER_DAY;
    if (ageDays <= maxAgeDays()) return Promise.resolve(null);
    return Promise.resolve({
      scoreDelta: SCORE_SUSPICIOUS,
      reasons: [`El comprobante tiene más de ${maxAgeDays()} días`],
      rejects: false,
    });
  }
}

function maxAgeDays(): number {
  const n = Number(process.env.PAYMENT_RECEIPT_MAX_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_DAYS;
}

/**
 * Adaptador del puerto PaymentAntifraudService: composite de reglas. Agrega los
 * hallazgos de cada regla en un único FraudAssessment del dominio:
 *  - alguna regla rechaza → "rejected" (score 100);
 *  - hallazgos sin rechazo → "suspicious" (score máximo acumulado, tope 100);
 *  - sin hallazgos → "approved" (score 0).
 */
@Injectable()
export class PaymentAntifraudComposite implements PaymentAntifraudService {
  constructor(private readonly rules: readonly PaymentFraudRule[]) {}

  async assess(input: PaymentAntifraudInput): Promise<FraudAssessment> {
    let score = 0;
    let rejects = false;
    const reasons: string[] = [];

    for (const rule of this.rules) {
      const finding = await rule.evaluate(input);
      if (!finding) continue;
      score += finding.scoreDelta;
      rejects ||= finding.rejects;
      reasons.push(...finding.reasons);
    }

    if (rejects) return { status: 'rejected', score: SCORE_REJECTED, reasons };
    if (reasons.length)
      return {
        status: 'suspicious',
        score: Math.min(score, SCORE_REJECTED),
        reasons,
      };
    return { status: 'approved', score: 0, reasons: [] };
  }
}
