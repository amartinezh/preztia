import { Money } from "../shared/money";

export interface Installment { seq: number; amountDueMinor: number; }

export function buildSchedule(principal: Money, interestPctBaseThousand: number, n: number): Installment[] {
  const total = principal.applyInterest(interestPctBaseThousand);
  const base = Math.floor(total.amountMinor / n);
  const out: Installment[] = [];
  let acc = 0;
  for (let seq = 1; seq <= n; seq++) {
    const amount = seq === n ? total.amountMinor - acc : base; // ajuste de redondeo en la última
    acc += amount;
    out.push({ seq, amountDueMinor: amount });
  }
  return out; // suma exacta = total
}
