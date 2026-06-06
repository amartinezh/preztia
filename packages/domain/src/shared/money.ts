export class DomainError extends Error {}

export class Money {
  private constructor(public readonly amountMinor: number, public readonly currency: string) {
    if (!Number.isInteger(amountMinor)) throw new DomainError("Money debe ser entero (centavos)");
  }
  static of(amountMinor: number, currency: string): Money { return new Money(amountMinor, currency); }
  add(o: Money): Money { this.same(o); return new Money(this.amountMinor + o.amountMinor, this.currency); }
  subtract(o: Money): Money { this.same(o); return new Money(this.amountMinor - o.amountMinor, this.currency); }
  applyInterest(pctBaseThousand: number): Money { // 20.0% -> 200
    return new Money(Math.floor(this.amountMinor * (1000 + pctBaseThousand) / 1000), this.currency);
  }
  private same(o: Money) { if (o.currency !== this.currency) throw new DomainError("Moneda distinta"); }
}
