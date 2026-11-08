import {
  cashBoxClass,
  sumTreasuryByClass,
  type CashBoxBalance,
} from './treasury-by-class';

/**
 * Especificación (Gherkin):
 *   Dado el saldo de cada caja activa de la empresa
 *   Cuando el panel de inicio reparte la tesorería
 *   Entonces el efectivo sin cobrador es "oficina", el efectivo con cobrador es "ruta" (la calle),
 *   las cuentas son "banco" y lo no identificado solo engorda el total;
 *   Y el total siempre cuadra con la suma de las clases.
 */
describe('Tesorería por clase de caja', () => {
  const office: CashBoxBalance = {
    type: 'CASH',
    assignedTo: null,
    balanceMinor: 500_000,
  };
  const route: CashBoxBalance = {
    type: 'CASH',
    assignedTo: 'cobrador-1',
    balanceMinor: 120_000,
  };
  const bank: CashBoxBalance = {
    type: 'BANK',
    assignedTo: null,
    balanceMinor: 2_000_000,
  };
  const transit: CashBoxBalance = {
    type: 'TRANSIT',
    assignedTo: null,
    balanceMinor: 30_000,
  };

  it('clasifica cada caja por su tipo y por si tiene cobrador', () => {
    expect(cashBoxClass(office)).toBe('OFFICE');
    expect(cashBoxClass(route)).toBe('ROUTE');
    expect(cashBoxClass(bank)).toBe('BANK');
    expect(cashBoxClass(transit)).toBe('TRANSIT');
  });

  it('suma por clase y el total cuadra con las clases', () => {
    const t = sumTreasuryByClass([office, route, bank, transit, route]);
    expect(t.officeMinor).toBe(500_000);
    expect(t.routeMinor).toBe(240_000);
    expect(t.bankMinor).toBe(2_000_000);
    expect(t.transitMinor).toBe(30_000);
    expect(t.totalMinor).toBe(
      t.officeMinor + t.routeMinor + t.bankMinor + t.transitMinor,
    );
    // Liquidez disponible: lo que se puede usar hoy (la calle y el tránsito no cuentan).
    expect(t.availableMinor).toBe(t.officeMinor + t.bankMinor);
    expect(t.availableMinor).toBe(2_500_000);
  });

  it('sin cajas, todo es cero (empresa recién creada)', () => {
    expect(sumTreasuryByClass([])).toEqual({
      totalMinor: 0,
      officeMinor: 0,
      routeMinor: 0,
      bankMinor: 0,
      availableMinor: 0,
      transitMinor: 0,
    });
  });

  it('una caja descuadrada en negativo resta con su signo, no se oculta', () => {
    const t = sumTreasuryByClass([office, { ...route, balanceMinor: -20_000 }]);
    expect(t.routeMinor).toBe(-20_000);
    expect(t.totalMinor).toBe(480_000);
  });
});
