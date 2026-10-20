import type { SeededRandom } from './random';
import type { CreditState } from './model';
import { balanceOf, dueUpTo, nextInstallmentMinor } from './portfolio';

// COMPORTAMIENTO de pago de cada perfil de cliente (regla de la simulación, no del negocio):
// decide si el cliente paga hoy, cuánto y por qué canal. La cartera resultante tiene así todas
// las situaciones reales: al día, atrasos de un par de días, abonos parciales, mora creciente,
// pagos por PIX y créditos saldados antes de tiempo.

export type PaymentChannel = 'CASH' | 'PIX';

export interface PaymentIntent {
  readonly channel: PaymentChannel;
  readonly amountMinor: number;
}

const LATE_PAY_PROBABILITY = 0.55;
const PARTIAL_PAY_PROBABILITY = 0.8;
const PIX_PAY_PROBABILITY = 0.85;
const DEFAULTER_RELAPSE_PROBABILITY = 0.07;
const PARTIAL_FRACTIONS = [0.5, 0.6, 0.7] as const;
/** Fracción pagada a partir de la cual el perfil SETTLER liquida todo de una vez. */
const SETTLE_EARLY_AT = 0.4;
/** Últimas cuotas: el cliente suele cerrar el crédito con un PIX (lo que lo deja SETTLED). */
const CLOSING_INSTALLMENTS = 2;
const CLOSE_WITH_PIX_PROBABILITY = 0.7;
const ROUNDING_MINOR = 100;

export function decidePayment(
  random: SeededRandom,
  credit: CreditState,
  date: string,
  isSunday: boolean,
): PaymentIntent | null {
  const exigible = dueUpTo(credit, date);
  const balance = balanceOf(credit);
  if (balance === 0) return null;
  const next = nextInstallmentMinor(credit);
  // Desde el día en que el cliente cae en mora deja de pagar (salvo un abono suelto ocasional),
  // sea cual sea su perfil: también un buen cliente puede quebrar en una renovación.
  if (credit.stopsPayingOn && date >= credit.stopsPayingOn) {
    return !isSunday && random.chance(DEFAULTER_RELAPSE_PROBABILITY)
      ? { channel: 'CASH', amountMinor: Math.min(balance, roundTo(next / 2)) }
      : null;
  }
  switch (credit.borrower.profile) {
    case 'PUNCTUAL':
      return isSunday || exigible === 0
        ? null
        : closing(random, credit, exigible, 'CASH');
    case 'LATE':
      if (isSunday || exigible === 0 || !random.chance(LATE_PAY_PROBABILITY))
        return null;
      return closing(
        random,
        credit,
        Math.min(exigible, next * random.pick([1, 1, 2])),
        'CASH',
      );
    case 'PARTIAL':
      if (isSunday || exigible === 0 || !random.chance(PARTIAL_PAY_PROBABILITY))
        return null;
      return {
        channel: 'CASH',
        amountMinor: Math.min(
          balance,
          roundTo(next * random.pick(PARTIAL_FRACTIONS)),
        ),
      };
    case 'DEFAULTER':
      return isSunday || exigible === 0
        ? null
        : { channel: 'CASH', amountMinor: exigible };
    case 'PIX':
      return exigible > 0 && random.chance(PIX_PAY_PROBABILITY)
        ? { channel: 'PIX', amountMinor: exigible }
        : null;
    case 'SETTLER':
      if (credit.paidSoFarMinor >= credit.totalDueMinor * SETTLE_EARLY_AT) {
        return { channel: 'PIX', amountMinor: balance };
      }
      return exigible > 0 ? { channel: 'PIX', amountMinor: exigible } : null;
  }
}

/** Al final del crédito, la última parte suele llegar por PIX (lo que cierra el crédito). */
function closing(
  random: SeededRandom,
  credit: CreditState,
  amountMinor: number,
  channel: PaymentChannel,
): PaymentIntent {
  const balance = balanceOf(credit);
  const nearEnd =
    balance <= nextInstallmentMinor(credit) * CLOSING_INSTALLMENTS;
  if (nearEnd && random.chance(CLOSE_WITH_PIX_PROBABILITY)) {
    return { channel: 'PIX', amountMinor: balance };
  }
  return { channel, amountMinor: Math.min(amountMinor, balance) };
}

function roundTo(amountMinor: number): number {
  return Math.max(
    ROUNDING_MINOR,
    Math.round(amountMinor / ROUNDING_MINOR) * ROUNDING_MINOR,
  );
}
