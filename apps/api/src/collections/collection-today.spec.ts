import { classifyToday } from './collection-today.repository';

/**
 * Especificación (Gherkin):
 *   Dado un cliente de la cartera del cobrador
 *   Cuando tiene cuota vencida hasta hoy sin pagar → está PENDIENTE de cobro
 *   Cuando no debe nada hoy pero abonó hoy → ya está COBRADO HOY
 *   Cuando no debe nada hoy y no abonó → está AL DÍA
 * (Los límites del día de negocio en la zona horaria de la empresa se prueban en tenant-timezone.spec.)
 */
describe('Mis cobros de hoy', () => {
  it('clasifica cada cliente por lo que debe hoy y lo que ya pagó hoy', () => {
    expect(classifyToday(5_000, 0)).toBe('PENDING');
    expect(classifyToday(5_000, 2_000)).toBe('PENDING'); // abonó parte: sigue debiendo hoy
    expect(classifyToday(0, 2_000)).toBe('PAID_TODAY');
    expect(classifyToday(0, 0)).toBe('UP_TO_DATE');
  });
});
