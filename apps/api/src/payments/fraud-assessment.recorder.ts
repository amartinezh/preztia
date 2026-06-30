import { schema } from '@preztiaos/db';
import { type Tx } from '../tenancy/unit-of-work';

// Registro de la bitácora antifraude (`fraud_assessment`). Funciones tx-aware (sin clase ni DI)
// para componer en la MISMA transacción que la operación que evalúan: la Fase 1 al persistir el
// comprobante y la Fase 2 al confirmar el pago. Append-only.

export type FraudPhase = 'PHASE1_SCREEN' | 'PHASE2_SETTLEMENT';

export interface FraudAssessmentRecord {
  readonly tenantId: string;
  readonly paymentId: string;
  readonly phase: FraudPhase;
  readonly status: string;
  readonly score: number | null;
  readonly reasons: readonly string[];
}

/** Inserta una evaluación antifraude dentro de la transacción dada. */
export async function recordFraudAssessmentTx(
  tx: Tx,
  input: FraudAssessmentRecord,
): Promise<void> {
  await tx.insert(schema.fraudAssessment).values({
    tenantId: input.tenantId,
    paymentId: input.paymentId,
    phase: input.phase,
    status: input.status,
    score: input.score,
    reasons: [...input.reasons],
  });
}

/**
 * Deriva el veredicto de la Fase 1 a partir del estado del pago y los motivos: REJECTED_FRAUD →
 * "rejected"; con motivos → "suspicious"; sin motivos → "approved". (REJECTED_INVALID no es una
 * señal de fraude → "approved".)
 */
export function phase1Status(
  paymentStatus: string,
  reasons: readonly string[] | null,
): string {
  if (paymentStatus === 'REJECTED_FRAUD') return 'rejected';
  return (reasons?.length ?? 0) > 0 ? 'suspicious' : 'approved';
}
