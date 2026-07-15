const DEFAULT_CRITICAL_OVERDUE_THRESHOLD = 3;

/**
 * Umbral vigente de cuotas vencidas (env `CRITICAL_OVERDUE_THRESHOLD`) a partir del cual un
 * cliente se considera en mora CRÍTICA. Compartido por el mapa de cobro (clientes críticos)
 * y el mapa de cartera (bandera `critical` por marcador).
 */
export function criticalOverdueThreshold(): number {
  const n = Number(process.env.CRITICAL_OVERDUE_THRESHOLD);
  return Number.isFinite(n) && n >= 1
    ? Math.floor(n)
    : DEFAULT_CRITICAL_OVERDUE_THRESHOLD;
}
