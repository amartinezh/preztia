/**
 * "Novedades de plataforma": el changelog PROPIO de PreztiaOS. A diferencia de los titulares del
 * sector (de terceros), este contenido es 100% nuestro y refuerza la percepción de una plataforma
 * viva y en evolución constante. Se edita a mano cuando se libera una capacidad relevante.
 *
 * Cada entrada refleja una capacidad REAL ya construida en el producto (no promesas).
 */

export type ChangelogTag =
  | 'lanzamiento'
  | 'seguridad'
  | 'integración'
  | 'mejora';

export interface ChangelogEntry {
  /** Fecha de negocio (YYYY-MM-DD). */
  readonly date: string;
  readonly title: string;
  readonly description: string;
  readonly tag: ChangelogTag;
}

export const PLATFORM_CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-06-29',
    title: 'Mercado Pago PIX con antifraude',
    description:
      'Conciliación de pagos PIX vía Mercado Pago con verificación antifraude de comprobantes.',
    tag: 'integración',
  },
  {
    date: '2026-06-22',
    title: 'Mapa de cobro y rutas optimizadas',
    description:
      'Ruta diaria de visita a clientes críticos priorizada y optimizada automáticamente en el mapa.',
    tag: 'mejora',
  },
  {
    date: '2026-06-15',
    title: 'Originación y cobranza por WhatsApp con IA',
    description:
      'Solicitudes de crédito y recordatorios de cobro asistidos por IA directamente en WhatsApp.',
    tag: 'lanzamiento',
  },
  {
    date: '2026-06-08',
    title: 'Antifraude documental (KYC)',
    description:
      'Validación de documentos con visión por IA y fuentes oficiales brasileñas; cifrado en reposo.',
    tag: 'seguridad',
  },
  {
    date: '2026-06-01',
    title: 'Aislamiento multi-tenant con RLS',
    description:
      'Cada empresa opera aislada por Row-Level Security de PostgreSQL y auditoría append-only del dinero.',
    tag: 'seguridad',
  },
];
