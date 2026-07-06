import { randomUUID } from 'node:crypto';
import { PaymentChargeDrizzleRepository } from './payment-charge.repository';
import {
  owner,
  cleanupTenant,
  closeOwner,
  hasDb,
} from '../../../test/db-helpers';

// Persistencia del cobro conversacional contra Postgres real: sesión → cobrança (con el
// COMPROBANTE esperado creado) → estado por webhook. Bajo RLS (withTenantTxFor fija el tenant).
const describeDb = hasDb() ? describe : describe.skip;

const repo = new PaymentChargeDrizzleRepository();
const CHANNEL = 'wapp-phone-1';

describeDb('PaymentChargeDrizzleRepository (integración)', () => {
  const tenants: string[] = [];
  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  /** tenant_config con el canal de WhatsApp para resolver el tenant desde el webhook. */
  async function seedChannel(tenantId: string): Promise<void> {
    await owner()`
      INSERT INTO tenant_config (tenant_id, whatsapp_phone_number_id, currency)
      VALUES (${tenantId}, ${CHANNEL}, 'BRL')`;
  }

  async function seedCredit(tenantId: string): Promise<string> {
    const [credit] = await owner()`
      INSERT INTO credit (tenant_id, borrower_id, zone_id, principal_minor, interest_pct,
        installments_count, currency, start_date, end_date, status)
      VALUES (${tenantId}, ${randomUUID()}, ${randomUUID()}, 100000, 0, 1, 'BRL',
        '2026-06-01', '2026-07-01', 'ACTIVE') RETURNING id`;
    return credit.id as string;
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('abre una sesión y la resuelve por canal; una segunda apertura reemplaza la anterior', async () => {
    const tenant = newTenant();
    await seedChannel(tenant);
    const creditId = await seedCredit(tenant);

    await repo.openSession({
      tenantId: tenant,
      creditId,
      phone: '5511999999999',
      channelId: CHANNEL,
      provider: 'PICPAY',
      installmentMinor: 25000,
      overdueMinor: 75000,
      currency: 'BRL',
    });
    // Reapertura: no debe dejar dos sesiones abiertas (índice único parcial).
    await repo.openSession({
      tenantId: tenant,
      creditId,
      phone: '5511999999999',
      channelId: CHANNEL,
      provider: 'PICPAY',
      installmentMinor: 30000,
      overdueMinor: 90000,
      currency: 'BRL',
    });

    const session = await repo.findOpenByChannel({
      channelId: CHANNEL,
      phone: '5511999999999',
    });
    expect(session).not.toBeNull();
    expect(session?.installmentMinor).toBe(30000);
    expect(session?.overdueMinor).toBe(90000);

    const [{ count }] =
      await owner()`SELECT count(*)::int AS count FROM payment_charge WHERE tenant_id = ${tenant} AND status = 'AWAITING_SELECTION'`;
    expect(count).toBe(1);
  });

  it('attachCharge crea el comprobante esperado (UNVERIFIED) y avanza la sesión a PENDING', async () => {
    const tenant = newTenant();
    await seedChannel(tenant);
    const creditId = await seedCredit(tenant);

    await repo.openSession({
      tenantId: tenant,
      creditId,
      phone: '5511888888888',
      channelId: CHANNEL,
      provider: 'PICPAY',
      installmentMinor: 25000,
      overdueMinor: 25000,
      currency: 'BRL',
    });
    const session = await repo.findOpenByChannel({
      channelId: CHANNEL,
      phone: '5511888888888',
    });

    await repo.attachCharge({
      sessionId: session!.sessionId,
      tenantId: tenant,
      amountMinor: 25000,
      merchantChargeId: 'CHG-INT-1',
      copyPaste: '00020126PIXCODE',
      expiresAt: null,
    });

    // La sesión pasó a PENDING con la cobrança y quedó ligada a un pago.
    const [charge] =
      await owner()`SELECT status, amount_minor, merchant_charge_id, payment_id FROM payment_charge WHERE id = ${session!.sessionId}`;
    expect(charge.status).toBe('PENDING');
    expect(Number(charge.amount_minor)).toBe(25000);
    expect(charge.merchant_charge_id).toBe('CHG-INT-1');
    expect(charge.payment_id).not.toBeNull();

    // El comprobante ESPERADO es un pago UNVERIFIED por el monto, ligado al crédito.
    const [pay] =
      await owner()`SELECT status, amount_minor, credit_id, txid FROM payment WHERE id = ${charge.payment_id}`;
    expect(pay.status).toBe('UNVERIFIED');
    expect(Number(pay.amount_minor)).toBe(25000);
    expect(pay.credit_id).toBe(creditId);
    expect(pay.txid).toBe('CHG-INT-1');

    // Ya no hay sesión abierta para ese teléfono.
    const open = await repo.findOpenByChannel({
      channelId: CHANNEL,
      phone: '5511888888888',
    });
    expect(open).toBeNull();
  });

  it('markStatusByMerchantChargeId refleja PAID solo desde PENDING', async () => {
    const tenant = newTenant();
    await seedChannel(tenant);
    const creditId = await seedCredit(tenant);
    await repo.openSession({
      tenantId: tenant,
      creditId,
      phone: '5511777777777',
      channelId: CHANNEL,
      provider: 'PICPAY',
      installmentMinor: 25000,
      overdueMinor: 25000,
      currency: 'BRL',
    });
    const session = await repo.findOpenByChannel({
      channelId: CHANNEL,
      phone: '5511777777777',
    });
    await repo.attachCharge({
      sessionId: session!.sessionId,
      tenantId: tenant,
      amountMinor: 25000,
      merchantChargeId: 'CHG-INT-2',
      copyPaste: '00020126PIXCODE',
      expiresAt: null,
    });

    await repo.markStatusByMerchantChargeId({
      tenantId: tenant,
      merchantChargeId: 'CHG-INT-2',
      status: 'PAID',
    });
    const [charge] =
      await owner()`SELECT status FROM payment_charge WHERE merchant_charge_id = 'CHG-INT-2' AND tenant_id = ${tenant}`;
    expect(charge.status).toBe('PAID');
  });
});
