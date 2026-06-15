// Puerto de salida del bounded context TRACKING (recorrido del cobrador). La infraestructura lo
// implementa con Drizzle bajo el rol `app` + RLS. Solo se DECLARA.

export interface NewLocation {
  readonly id: string;
  readonly tenantId: string;
  readonly collectorId: string;
  readonly lat: number;
  readonly lng: number;
}

export interface LocationStore {
  /** Inserta un punto del recorrido (append-only). */
  record(location: NewLocation): Promise<void>;
}
