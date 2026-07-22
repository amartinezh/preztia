import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * ¿El crédito pertenece a la cartera asignada de un cobrador?
 *
 * RLS aísla por TENANT; el alcance por cliente (qué cobrador gestiona a qué deudor) es authZ
 * de aplicación y vive en `collector_client`. Sin esta comprobación, un cobrador puede abonar
 * sobre el crédito de CUALQUIER deudor del tenant —incluido uno que no cobra él— que es el
 * vector de fraude interno más directo del producto.
 *
 * Mismo patrón que `VisitTargetsRepository.findForCollector` en el slice de cobranza, pero sin
 * su filtro de mora: aquí importa la pertenencia a la cartera, no que el crédito esté vencido.
 */
@Injectable()
export class CollectorCreditScopeReader {
  async isInPortfolio(input: {
    tenantId: string;
    collectorId: string;
    creditId: string;
  }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.credit.id })
        .from(schema.credit)
        .innerJoin(
          schema.collectorClient,
          eq(schema.collectorClient.borrowerId, schema.credit.borrowerId),
        )
        .where(
          and(
            eq(schema.credit.id, input.creditId),
            eq(schema.collectorClient.collectorId, input.collectorId),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }
}
