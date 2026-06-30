import {
  analyzeE2EId,
  isEligiblePixCredit,
  isKnownIspb,
  matchCreditsToClaims,
  matchReceiver,
  type PixReceiptData,
  type ReceiptClaimRef,
} from '@preztiaos/domain';
import { parseSettlementCsv } from '../mp-report-csv.parser';
import {
  RECEIPT_FIXTURES,
  RECEIVER_IDENTITY,
  SETTLEMENT_REPORT_CSV,
  receiptFixture,
} from './receipts.fixture';

// Demostración del validador sobre el SET de casos documentados (válido / E2E malformado /
// E2E reusado / recebedor erróneo / monto que matchea / monto sin match). Usa las reglas PURAS
// de dominio (la Fase 1 con BD —dedup sha256/E2E— se cubre en sus propios tests). Sirve a la vez
// como prueba y como documentación viva de los veredictos esperados.

/** Fase 1 con las señales PURAS (E2E bien formado + match de recebedor). */
function phase1Pure(pix: PixReceiptData): { ok: boolean; reason: string } {
  if (!pix.endToEndId || !analyzeE2EId(pix.endToEndId).valid) {
    return { ok: false, reason: 'e2e' };
  }
  const receiver = matchReceiver(
    { pixKey: pix.receiverPixKey, name: pix.receiverName },
    { pixKey: RECEIVER_IDENTITY.pixKey, name: RECEIVER_IDENTITY.name },
  );
  if (!receiver.inconclusive && !receiver.matches) {
    return { ok: false, reason: 'receiver' };
  }
  return { ok: true, reason: 'ok' };
}

describe('Fixtures del validador antifraude PIX (Mercado Pago)', () => {
  it('todos los E2E "válidos" del set usan un ISPB conocido', () => {
    for (const key of ['valido', 'monto_matchea', 'monto_sin_match']) {
      const analysis = analyzeE2EId(receiptFixture(key).pix.endToEndId ?? '');
      expect(analysis.valid).toBe(true);
      expect(analysis.ispb && isKnownIspb(analysis.ispb)).toBe(true);
    }
  });

  describe('Fase 1 (señales puras) coincide con el veredicto esperado', () => {
    for (const fixture of RECEIPT_FIXTURES) {
      if (fixture.key === 'e2e_reusado') continue; // se valida aparte (dedup es de BD)
      it(`${fixture.key}: ${fixture.description}`, () => {
        const result = phase1Pure(fixture.pix);
        expect(result.ok).toBe(fixture.expected.phase1 === 'pass');
      });
    }

    it('e2e_reusado: estructuralmente válido, lo rechaza el dedup de BD (mismo E2E que "valido")', () => {
      const reused = receiptFixture('e2e_reusado');
      expect(reused.pix.endToEndId).toBe(
        receiptFixture('valido').pix.endToEndId,
      );
      // Por estructura/recebedor pasaría; el rechazo viene de DuplicateEndToEndRule (BD).
      expect(phase1Pure(reused.pix).ok).toBe(true);
    });
  });

  describe('Fase 2 (ground truth): el match contra el CSV decide CONFIRMED/UNCONFIRMED', () => {
    const credits = parseSettlementCsv(SETTLEMENT_REPORT_CSV);

    it('el CSV trae exactamente 2 créditos PIX elegibles (excluye tarjeta y refund)', () => {
      expect(credits.filter(isEligiblePixCredit)).toHaveLength(2);
    });

    it('confirma los montos con crédito real y deja sin confirmar el "falso perfecto"', () => {
      // Solo los comprobantes que pasan Fase 1 y llegan a Fase 2.
      const claims: ReceiptClaimRef[] = RECEIPT_FIXTURES.filter(
        (f) => f.expected.phase1 === 'pass' && f.expected.phase2,
      ).map((f) => ({ id: f.key, amountMinor: f.pix.amountMinor ?? 0 }));

      const result = matchCreditsToClaims(claims, credits);
      const confirmed = new Set(result.matches.map((m) => m.claimId));

      for (const fixture of RECEIPT_FIXTURES) {
        if (fixture.expected.phase2 === 'CONFIRMED') {
          expect(confirmed.has(fixture.key)).toBe(true);
        } else if (fixture.expected.phase2 === 'UNCONFIRMED') {
          expect(confirmed.has(fixture.key)).toBe(false);
        }
      }
      expect(result.unmatchedClaimIds).toEqual(['monto_sin_match']);
    });
  });
});
