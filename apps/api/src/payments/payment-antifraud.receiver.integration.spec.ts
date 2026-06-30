import { randomUUID } from 'node:crypto';
import { ReceiverMatchRule } from './payment-antifraud.service';
import { BankAccountDrizzleRepository } from '../cash/bank-account.repository';
import { BankCredentialDrizzleRepository } from '../cash/bank-credential.repository';
import { cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';
import type { PaymentAntifraudInput } from '@preztiaos/application';
import type { PixReceiptData } from '@preztiaos/domain';

// Integración de ReceiverMatchRule contra Postgres real (RLS): la regla carga las cuentas
// recaudadoras ACTIVAS del tenant y delega la comparación al dominio. Verifica que solo el
// crédito a una llave/cuenta configurada del tenant pasa; lo demás se rechaza.
const describeDb = hasDb() ? describe : describe.skip;

const accounts = new BankAccountDrizzleRepository(
  new BankCredentialDrizzleRepository(),
);
const rule = new ReceiverMatchRule();

function pix(
  receiverPixKey: string | null,
  receiverName: string | null,
): PixReceiptData {
  return {
    amountMinor: 5000,
    currency: 'BRL',
    paidAt: '2026-06-10T12:30:00Z',
    payerName: 'Pagador',
    payerTaxId: null,
    payerBankName: null,
    receiverName,
    receiverPixKey,
    endToEndId: 'E10573521202606101230ABCDEF01234',
    txid: null,
    raw: {},
  };
}

function input(
  tenantId: string,
  receiverPixKey: string | null,
  receiverName: string | null,
): PaymentAntifraudInput {
  return {
    tenantId,
    sha256: randomUUID(),
    pix: pix(receiverPixKey, receiverName),
    receivedAt: '2026-06-29T00:00:00Z',
    payerPhone: '5511999999999',
  };
}

describeDb('ReceiverMatchRule (integración)', () => {
  const tenants: string[] = [];
  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  async function seedAccount(tenantId: string): Promise<void> {
    await accounts.create(tenantId, {
      label: 'Mercado Pago',
      bankName: 'Mercado Pago',
      countryCode: 'BR',
      bankCode: 'MERCADOPAGO',
      providerType: 'MERCADOPAGO',
      pixKey: 'pix@preztia.com',
      receiverName: 'Preztia LTDA',
    });
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('no penaliza cuando la llave PIX del recibo coincide con una cuenta activa', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    expect(
      await rule.evaluate(input(tenant, 'pix@preztia.com', null)),
    ).toBeNull();
  });

  it('RECHAZA cuando la llave PIX del recibo no coincide con ninguna cuenta', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    const finding = await rule.evaluate(
      input(tenant, 'otro@banco.com', 'Preztia LTDA'),
    );
    expect(finding?.rejects).toBe(true);
    expect(finding?.reasons[0]).toContain('llave PIX');
  });

  it('no concluye (null) cuando el tenant no tiene cuenta activa', async () => {
    const tenant = newTenant();
    expect(
      await rule.evaluate(input(tenant, 'pix@preztia.com', null)),
    ).toBeNull();
  });
});
