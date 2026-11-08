import { DomainError } from '@preztiaos/domain';
import { businessDayBoundsIn } from './tenant-timezone';

/**
 * Especificación (Gherkin):
 *   Dado que la empresa opera en una zona horaria configurada (ADR #46)
 *   Cuando se pide la ventana de un día de negocio
 *   Entonces empieza a la medianoche LOCAL de ese día y termina (exclusive) a la medianoche
 *   local del día siguiente, expresadas como instantes UTC;
 *   Y una fecha que no existe en el calendario falla rápido.
 */
describe('Ventana del día de negocio de la empresa', () => {
  it('en América/São Paulo (UTC−3) el día empieza a las 03:00Z y termina a las 03:00Z del siguiente', () => {
    const day = businessDayBoundsIn('2026-11-08', 'America/Sao_Paulo');
    expect(day.date).toBe('2026-11-08');
    expect(day.start.toISOString()).toBe('2026-11-08T03:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });

  it('en América/Bogotá (UTC−5) un abono a las 23:00 locales sigue siendo del mismo día', () => {
    const day = businessDayBoundsIn('2026-11-08', 'America/Bogota');
    expect(day.start.toISOString()).toBe('2026-11-08T05:00:00.000Z');
    // 23:00 de Bogotá = 04:00Z del 9: en UTC ya cambió la fecha, en el negocio no.
    const lateNight = new Date('2026-11-09T04:00:00.000Z');
    expect(lateNight >= day.start && lateNight < day.end).toBe(true);
  });

  it('la ventana es semiabierta: el instante final pertenece al día siguiente', () => {
    const today = businessDayBoundsIn('2026-11-08', 'America/Bogota');
    const tomorrow = businessDayBoundsIn('2026-11-09', 'America/Bogota');
    expect(today.end.getTime()).toBe(tomorrow.start.getTime());
  });

  it('cruza el fin de mes y de año con el calendario, no con aritmética de cadenas', () => {
    const day = businessDayBoundsIn('2026-12-31', 'UTC');
    expect(day.start.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(day.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('falla rápido con una fecha inexistente', () => {
    expect(() => businessDayBoundsIn('2026-02-30', 'America/Bogota')).toThrow(
      DomainError,
    );
  });
});
