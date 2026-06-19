import { randomUUID } from 'node:crypto';
import { BankAccountDrizzleRepository } from './bank-account.repository';
import { TenantBankAccountDrizzleRepository } from '../payments/tenant-bank-account.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Verifica de extremo a extremo que la credencial bancaria queda CIFRADA en reposo (#4):
// lo que se persiste en la columna no es el secreto, y la lectura para uso lo descifra.
const describeDb = hasDb() ? describe : describe.skip;

const crud = new BankAccountDrizzleRepository();
const reader = new TenantBankAccountDrizzleRepository();

describeDb(
  'BankAccount: cifrado de credenciales en reposo (integración)',
  () => {
    const tenants: string[] = [];
    function newTenant(): string {
      const id = randomUUID();
      tenants.push(id);
      return id;
    }

    afterAll(async () => {
      for (const t of tenants) await cleanupTenant(t);
      await closeOwner();
    });

    it('persiste la apiKey cifrada y la descifra al leerla para uso', async () => {
      const tenant = newTenant();
      const account = await crud.create(tenant, {
        label: 'Inter',
        bankName: 'Inter',
        countryCode: 'BR',
        bankCode: 'INTER',
        apiKey: 'sk-credencial-secreta-123',
      });

      // En la BD el valor está cifrado (prefijo versionado), nunca el secreto en claro.
      const [row] =
        await owner()`SELECT api_key FROM tenant_bank_account WHERE id = ${account.id}`;
      expect(row.api_key).toMatch(/^enc:v1:/);
      expect(row.api_key).not.toContain('sk-credencial-secreta-123');

      // La vista expone solo `hasApiKey`, jamás el secreto.
      expect(account.hasApiKey).toBe(true);
      expect(JSON.stringify(account)).not.toContain(
        'sk-credencial-secreta-123',
      );

      // La lectura para uso (adaptador bancario) recupera el texto plano.
      const apiKey = await reader.findApiKey({
        tenantId: tenant,
        countryCode: 'BR',
        bankCode: 'INTER',
      });
      expect(apiKey).toBe('sk-credencial-secreta-123');
    });
  },
);
