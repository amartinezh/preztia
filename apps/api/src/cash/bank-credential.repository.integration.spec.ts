import { randomUUID } from 'node:crypto';
import { BankAccountDrizzleRepository } from './bank-account.repository';
import { BankCredentialDrizzleRepository } from './bank-credential.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Verifica de extremo a extremo el almacén de SECRETOS NOMBRADOS de un proveedor (ej. Mercado
// Pago: public_key + access_token): cifrado en reposo, round-trip al leer, upsert idempotente,
// exposición de solo la PRESENCIA del secreto, y aislamiento por tenant (RLS).
const describeDb = hasDb() ? describe : describe.skip;

const creds = new BankCredentialDrizzleRepository();
const accounts = new BankAccountDrizzleRepository(creds);

describeDb(
  'BankCredential: secretos cifrados por proveedor (integración)',
  () => {
    const tenants: string[] = [];
    function newTenant(): string {
      const id = randomUUID();
      tenants.push(id);
      return id;
    }

    async function newAccount(tenantId: string): Promise<string> {
      const acc = await accounts.create(tenantId, {
        label: 'Mercado Pago',
        bankName: 'Mercado Pago',
        countryCode: 'BR',
        bankCode: 'MERCADOPAGO',
      });
      return acc.id;
    }

    afterAll(async () => {
      for (const t of tenants) await cleanupTenant(t);
      await closeOwner();
    });

    it('persiste el secreto CIFRADO en reposo y lo descifra al leerlo', async () => {
      const tenant = newTenant();
      const bankAccountId = await newAccount(tenant);
      const secret = 'APP_USR-access-token-super-secreto-123';

      await creds.set({
        tenantId: tenant,
        bankAccountId,
        name: 'access_token',
        value: secret,
      });

      // En la BD el valor está cifrado (prefijo versionado), jamás el secreto en claro.
      const [row] =
        await owner()`SELECT value_encrypted FROM bank_credential WHERE bank_account_id = ${bankAccountId} AND name = 'access_token'`;
      expect(row.value_encrypted).toMatch(/^enc:v1:/);
      expect(row.value_encrypted).not.toContain(secret);

      // La lectura para uso (adaptador) recupera el texto plano.
      const got = await creds.get({
        tenantId: tenant,
        bankAccountId,
        name: 'access_token',
      });
      expect(got).toBe(secret);
    });

    it('upsert idempotente: re-setear el mismo nombre ROTA el valor sin duplicar fila', async () => {
      const tenant = newTenant();
      const bankAccountId = await newAccount(tenant);

      await creds.set({
        tenantId: tenant,
        bankAccountId,
        name: 'access_token',
        value: 'v1',
      });
      await creds.set({
        tenantId: tenant,
        bankAccountId,
        name: 'access_token',
        value: 'v2',
      });

      const [{ count }] =
        await owner()`SELECT count(*)::int AS count FROM bank_credential WHERE bank_account_id = ${bankAccountId} AND name = 'access_token'`;
      expect(count).toBe(1);
      expect(
        await creds.get({
          tenantId: tenant,
          bankAccountId,
          name: 'access_token',
        }),
      ).toBe('v2');
    });

    it('setMany cifra varios secretos y borra los marcados null; getAll descifra todos', async () => {
      const tenant = newTenant();
      const bankAccountId = await newAccount(tenant);

      await creds.setMany({
        tenantId: tenant,
        bankAccountId,
        secrets: {
          public_key: 'APP_USR-pk',
          access_token: 'APP_USR-at',
          webhook_secret: 'wh',
        },
      });
      // null borra; los demás se mantienen.
      await creds.setMany({
        tenantId: tenant,
        bankAccountId,
        secrets: { webhook_secret: null },
      });

      const all = await creds.getAll({ tenantId: tenant, bankAccountId });
      expect(all).toEqual({
        public_key: 'APP_USR-pk',
        access_token: 'APP_USR-at',
      });
    });

    it('listNames revela solo la PRESENCIA del secreto, nunca el valor', async () => {
      const tenant = newTenant();
      const bankAccountId = await newAccount(tenant);

      await creds.setMany({
        tenantId: tenant,
        bankAccountId,
        secrets: { public_key: 'APP_USR-pk', access_token: 'APP_USR-at' },
      });

      const names = (
        await creds.listNames({ tenantId: tenant, bankAccountId })
      ).sort();
      expect(names).toEqual(['access_token', 'public_key']);
      expect(JSON.stringify(names)).not.toContain('APP_USR-at');
    });

    it('remove borra un secreto (baja de credencial)', async () => {
      const tenant = newTenant();
      const bankAccountId = await newAccount(tenant);

      await creds.set({
        tenantId: tenant,
        bankAccountId,
        name: 'access_token',
        value: 'x',
      });
      await creds.remove({
        tenantId: tenant,
        bankAccountId,
        name: 'access_token',
      });

      expect(
        await creds.get({
          tenantId: tenant,
          bankAccountId,
          name: 'access_token',
        }),
      ).toBeNull();
    });

    it('RLS: el secreto de un tenant no es legible bajo el contexto de otro tenant', async () => {
      const tenantA = newTenant();
      const tenantB = newTenant();
      const bankAccountId = await newAccount(tenantA);
      await creds.set({
        tenantId: tenantA,
        bankAccountId,
        name: 'access_token',
        value: 'solo-A',
      });

      // Bajo el contexto de B, la RLS oculta la fila de A → no hay secreto.
      const leaked = await creds.get({
        tenantId: tenantB,
        bankAccountId,
        name: 'access_token',
      });
      expect(leaked).toBeNull();
    });
  },
);
