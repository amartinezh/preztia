import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { BorrowerCreditPolicyPort } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { outstandingOfBorrower } from './borrower-credit-lock';

/**
 * Adaptador del puerto de política de crédito: lee el cupo/bloqueo del cliente (`borrower`) y
 * su saldo vigente (Σ saldo de cuotas de créditos ACTIVE). No contiene reglas: la decisión
 * (cupo/bloqueo) la toma el dominio (`assertCanReceiveCredit`) en el handler.
 */
export class BorrowerPolicyRepository implements BorrowerCreditPolicyPort {
  async find(input: { tenantId: string; borrowerId: string }) {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [borrower] = await tx
        .select({
          creditBlocked: schema.borrower.creditBlocked,
          creditLimitMinor: schema.borrower.creditLimitMinor,
        })
        .from(schema.borrower)
        .where(eq(schema.borrower.id, input.borrowerId))
        .limit(1);
      if (!borrower) return null;

      return {
        creditBlocked: borrower.creditBlocked,
        creditLimitMinor: borrower.creditLimitMinor,
        outstandingMinor: await outstandingOfBorrower(tx, input.borrowerId),
      };
    });
  }
}
