import { CreditRepository } from '@preztiaos/application';
import { schema } from '@preztiaos/db';
import { withTenantTx } from '../tenancy/unit-of-work';

export class CreditDrizzleRepository implements CreditRepository {
  async save(c: {
    id: string;
    tenantId: string;
    principalMinor: number;
    currency: string;
  }): Promise<void> {
    await withTenantTx(async (tx) => {
      await tx.insert(schema.credit).values({
        id: c.id,
        tenantId: c.tenantId,
        borrowerId: c.id,
        zoneId: c.id, // placeholders del esqueleto
        principalMinor: c.principalMinor,
        interestPct: 200,
        installmentsCount: 20,
        currency: c.currency,
        startDate: '2026-01-01',
        endDate: '2026-01-21',
      });
    });
  }
}
