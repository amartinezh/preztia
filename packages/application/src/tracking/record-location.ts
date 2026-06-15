import { randomUUID } from "node:crypto";
import { assertCoordinate } from "@preztiaos/domain";
import type { LocationStore } from "./ports";

// Caso de uso: registrar la posición actual del cobrador. La coordenada se valida en el dominio
// (fallo rápido si está fuera de rango); el registro es append-only (un punto del recorrido).

export interface RecordLocationCommand {
  tenantId: string;
  collectorId: string;
  lat: number;
  lng: number;
}

export class RecordCollectorLocationHandler {
  constructor(private readonly locations: LocationStore) {}

  async execute(cmd: RecordLocationCommand): Promise<{ id: string }> {
    assertCoordinate(cmd.lat, cmd.lng);
    const id = randomUUID();
    await this.locations.record({
      id,
      tenantId: cmd.tenantId,
      collectorId: cmd.collectorId,
      lat: cmd.lat,
      lng: cmd.lng,
    });
    return { id };
  }
}
