// Puertos del slice de VISITAS DE COBRO EN CAMPO (perfil del cobrador). La capa de aplicación los
// define; la infraestructura (Drizzle) los implementa (inversión de dependencias). El listado de
// pendientes/visitados es un read model que vive en infraestructura (SQL de mora + alcance del
// cobrador); aquí solo van los puertos que necesitan los casos de uso de escritura.

/** Snapshot de la mora de un crédito asignado al cobrador, para decidir y registrar una visita. */
export interface CreditOverdueSnapshot {
  readonly creditId: string;
  readonly borrowerId: string;
  /** Nº de cuotas vencidas actuales. */
  readonly overdueCount: number;
  /** Días desde la cuota vencida más antigua (0 si no hay mora). */
  readonly daysOverdue: number;
}

/** Read model: mora de un crédito dentro del alcance del cobrador (RLS + collector_client). */
export interface VisitOverdueReader {
  /** Snapshot del crédito si está asignado al cobrador; `null` si no existe o no es suyo. */
  findForCollector(input: {
    tenantId: string;
    collectorId: string;
    creditId: string;
  }): Promise<CreditOverdueSnapshot | null>;
}

/** Persistencia append-only de observaciones de visita. */
export interface CollectionNoteRepository {
  add(input: {
    tenantId: string;
    creditId: string;
    borrowerId: string;
    authorId: string;
    body: string;
  }): Promise<{ id: string; createdAt: string }>;
  /** Fecha (ISO) de la observación más reciente del crédito; `null` si no hay ninguna. */
  latestNoteAt(input: { tenantId: string; creditId: string }): Promise<string | null>;
}

/** Persistencia append-only de visitas + lectura de la última (para el reagendamiento por ciclo). */
export interface CollectionVisitRepository {
  record(input: {
    tenantId: string;
    creditId: string;
    borrowerId: string;
    collectorId: string;
    overdueCountAtVisit: number;
    daysOverdueAtVisit: number;
  }): Promise<{ id: string; visitedAt: string }>;
  /** Última visita del crédito; `null` si nunca se ha visitado. */
  lastVisit(input: {
    tenantId: string;
    creditId: string;
  }): Promise<{ overdueCountAtVisit: number; visitedAt: string } | null>;
}

/** Bitácora append-only de la visita en `audit_log` (auditabilidad, §3.7). */
export interface CollectionVisitAuditLog {
  recordVisit(input: {
    tenantId: string;
    creditId: string;
    collectorId: string;
    overdueCountAtVisit: number;
  }): Promise<void>;
}
