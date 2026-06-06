import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Entrada que valida la API en la frontera (zod).
// tenantId viene del header x-tenant-id y currency lo fija el servidor, por eso no van aquí.
export const grantCreditInput = z.object({
  borrowerId: z.string().uuid(),
  zoneId: z.string().uuid(),
  principalMinor: z.number().int().positive(),
  interestPct: z.number().nonnegative(),
  installmentsCount: z.number().int().positive(),
});
export type GrantCreditInput = z.infer<typeof grantCreditInput>;

export const grantCreditOutput = z.object({
  id: z.string().uuid(),
  installments: z.number().int(),
});
export type GrantCreditOutput = z.infer<typeof grantCreditOutput>;

// Contrato ts-rest: misma fuente de verdad para API (NestJS) y clientes (web/mobile).
export const creditContract = c.router({
  grantCredit: {
    method: "POST",
    path: "/credits",
    headers: z.object({ "x-tenant-id": z.string().uuid() }),
    body: grantCreditInput,
    responses: {
      201: grantCreditOutput,
    },
    summary: "Otorga un crédito a un deudor dentro de una zona",
  },
});
