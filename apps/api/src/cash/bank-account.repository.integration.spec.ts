import { randomUUID } from 'node:crypto';
import { BankAccountDrizzleRepository } from './bank-account.repository';
import { BankCredentialDrizzleRepository } from './bank-credential.repository';
import { TenantBankAccountDrizzleRepository } from '../payments/tenant-bank-account.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Verifica de extremo a extremo que la credencial bancaria queda CIFRADA en reposo (#4):
// lo que se persiste en la columna no es el secreto, y la lectura para uso lo descifra.
const describeDb = hasDb() ? describe : describe.skip;

const crud = new BankAccountDrizzleRepository(
  new BankCredentialDrizzleRepository(),
);
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

    it('persiste y devuelve la config de proveedor (Mercado Pago): tipo, recebedor y reportConfig', async () => {
      const tenant = newTenant();
      const created = await crud.create(tenant, {
        label: 'Mercado Pago',
        bankName: 'Mercado Pago',
        countryCode: 'BR',
        bankCode: 'MERCADOPAGO',
        providerType: 'MERCADOPAGO',
        receiverTaxId: '12345678000199',
        receiverName: 'Preztia LTDA',
        reportConfig: {
          reportTranslation: 'pt',
          timezone: 'America/Sao_Paulo',
          windowDays: 7,
        },
      });

      expect(created.providerType).toBe('MERCADOPAGO');
      expect(created.receiverTaxId).toBe('12345678000199');
      expect(created.receiverName).toBe('Preztia LTDA');
      expect(created.reportConfig).toEqual({
        reportTranslation: 'pt',
        timezone: 'America/Sao_Paulo',
        windowDays: 7,
      });

      // El PATCH actualiza la config no secreta (round-trip de update).
      const updated = await crud.update(tenant, created.id, {
        reportConfig: { reportTranslation: 'en', windowDays: 14 },
      });
      expect(updated.reportConfig).toEqual({
        reportTranslation: 'en',
        windowDays: 14,
      });
    });

    it('por defecto el proveedor es MANUAL cuando no se especifica', async () => {
      const tenant = newTenant();
      const created = await crud.create(tenant, {
        label: 'Caja Local',
        bankName: 'Caja Local',
        countryCode: 'BR',
        bankCode: 'LOCAL',
      });
      expect(created.providerType).toBe('MANUAL');
      expect(created.reportConfig).toBeNull();
    });
  },
);
