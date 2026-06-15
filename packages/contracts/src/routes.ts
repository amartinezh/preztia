import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de RUTAS / COBROS ("Lista de cobros"): vista del socio sobre cada cobrador y su
// cartera. Una "ruta" reusa el modelo existente (Zoning + collector): es un COLLECTOR con sus
// zonas asignadas y el número de clientes a su cargo. Read-model; no muta estado.

export const route = z.object({
  collectorId: z.string().uuid(),
  /** Identificador legible (email del cobrador). */
  name: z.string(),
  /** Código corto estable derivado del id. */
  code: z.string(),
  /** Subárbol(es) de zonas asignadas al cobrador (paths ltree). */
  zonePaths: z.array(z.string()),
  /** Clientes (deudores) asignados al cobrador. */
  clientsCount: z.number().int(),
  active: z.boolean(),
});
export type Route = z.infer<typeof route>;

export const listRoutesOutput = z.object({ items: z.array(route) });

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const routesContract = c.router({
  listRoutes: {
    method: "GET",
    path: "/routes",
    headers: tenantHeaders,
    responses: { 200: listRoutesOutput },
    summary: "Lista de cobros: cobradores con sus zonas y número de clientes",
  },
});
