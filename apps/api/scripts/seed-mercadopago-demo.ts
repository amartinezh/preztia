import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@preztiaos/db';
import { isEligiblePixCredit } from '@preztiaos/domain';
import { encryptSecret } from '../src/shared/secret-cipher';
import { CREDENTIAL_NAME } from '../src/cash/bank-credential.names';
import { parseSettlementCsv } from '../src/payments/banking/mercadopago/mp-report-csv.parser';
import {
  RECEIPT_FIXTURES,
  RECEIVER_IDENTITY,
  SETTLEMENT_REPORT_CSV,
} from '../src/payments/banking/mercadopago/__fixtures__/receipts.fixture';

/**
 * Seed de DEMO de Mercado Pago: agrega a la tenant de `seed:demo` un banco MP configurado
 * (credenciales de EJEMPLO, no reales), créditos + comprobantes pendientes de los casos de
 * Fase 2 y los créditos del settlement_report sintético ya ingeridos. Tras correrlo:
 *
 *   POST /payments/reconcile-settlement  (header x-tenant-id de la tenant demo)
 *     → "valido" y "monto_matchea" quedan CONFIRMED; "monto_sin_match" sigue UNCONFIRMED.
 *
 * Idempotente (ids fijos). Usa DATABASE_URL (superusuario, bypassa RLS). Requiere `seed:demo`.
 */
config({ path: resolve(__dirname, '../../../.env') });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const MP_BANK_ACCOUNT_ID = '0000000a-0000-4000-8000-0000000a0001';

// Casos de Fase 2 a sembrar como comprobantes pendientes (los de Fase 1 se ven en los tests).
const PHASE2_KEYS = ['valido', 'monto_matchea', 'monto_sin_match'] as const;

// IDs fijos por caso (idempotencia: re-seed sin duplicar).
const FIXED: Record<
  (typeof PHASE2_KEYS)[number],
  { creditId: string; paymentId: string }
> = {
  valido: {
    creditId: '0000000b-0000-4000-8000-000000000a01',
    paymentId: '0000000c-0000-4000-8000-000000000a01',
  },
  monto_matchea: {
    creditId: '0000000b-0000-4000-8000-000000000a02',
    paymentId: '0000000c-0000-4000-8000-000000000a02',
  },
  monto_sin_match: {
    creditId: '0000000b-0000-4000-8000-000000000a03',
    paymentId: '0000000c-0000-4000-8000-000000000a03',
  },
};

// Credenciales de EJEMPLO — NO son reales; reemplazar por las del panel de MP.
const EXAMPLE_CREDENTIALS = {
  [CREDENTIAL_NAME.publicKey]: 'APP_USR-PUBLIC-KEY-EXAMPLE-0000',
  [CREDENTIAL_NAME.accessToken]: 'APP_USR-ACCESS-TOKEN-EXAMPLE-0000',
  [CREDENTIAL_NAME.webhookSecret]: 'WEBHOOK-SECRET-EXAMPLE-0000',
} as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurada');
  const db = createDb(databaseUrl);

  const [tenant] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, TENANT_ID));
  if (!tenant) {
    throw new Error(
      'No existe la tenant demo. Corré primero `pnpm --filter api seed:demo`.',
    );
  }

  await db.transaction(async (tx) => {
    // Limpieza idempotente de lo que crea este seed (orden de FKs).
    await tx
      .delete(schema.incomingCredit)
      .where(eq(schema.incomingCredit.bankAccountId, MP_BANK_ACCOUNT_ID));
    for (const key of PHASE2_KEYS) {
      await tx
        .delete(schema.paymentAllocation)
        .where(eq(schema.paymentAllocation.paymentId, FIXED[key].paymentId));
    }
    await tx
      .delete(schema.bankCredential)
      .where(eq(schema.bankCredential.bankAccountId, MP_BANK_ACCOUNT_ID));

    // 1) Banco Mercado Pago configurado (no secreto: providerType + recebedor + reportConfig).
    await tx
      .insert(schema.tenantBankAccount)
      .values({
        id: MP_BANK_ACCOUNT_ID,
        tenantId: TENANT_ID,
        label: 'Mercado Pago (demo)',
        bankName: 'Mercado Pago',
        countryCode: 'BR',
        bankCode: 'MERCADOPAGO',
        providerType: 'MERCADOPAGO',
        pixKey: RECEIVER_IDENTITY.pixKey,
        receiverTaxId: RECEIVER_IDENTITY.taxId,
        receiverName: RECEIVER_IDENTITY.name,
        reportConfig: {
          reportTranslation: 'en',
          timezone: 'America/Sao_Paulo',
          windowDays: 7,
        },
      })
      .onConflictDoNothing();

    // 2) Credenciales de ejemplo, CIFRADAS en reposo.
    for (const [name, value] of Object.entries(EXAMPLE_CREDENTIALS)) {
      await tx.insert(schema.bankCredential).values({
        tenantId: TENANT_ID,
        bankAccountId: MP_BANK_ACCOUNT_ID,
        name,
        valueEncrypted: encryptSecret(value),
      });
    }

    // 3) Por cada caso de Fase 2: crédito ACTIVO + cuota + comprobante pendiente (UNVERIFIED).
    for (const key of PHASE2_KEYS) {
      const fixture = RECEIPT_FIXTURES.find((f) => f.key === key);
      if (!fixture) continue;
      const amount = fixture.pix.amountMinor ?? 0;
      const creditId = FIXED[key].creditId;
      const paymentId = FIXED[key].paymentId;

      await tx.delete(schema.payment).where(eq(schema.payment.id, paymentId));
      await tx
        .delete(schema.installment)
        .where(eq(schema.installment.creditId, creditId));
      await tx.delete(schema.credit).where(eq(schema.credit.id, creditId));

      await tx.insert(schema.credit).values({
        id: creditId,
        tenantId: TENANT_ID,
        borrowerId: randomUUID(),
        zoneId: randomUUID(),
        principalMinor: amount,
        interestPct: 0,
        installmentsCount: 1,
        currency: 'BRL',
        startDate: '2026-06-01',
        endDate: '2026-07-01',
        status: 'ACTIVE',
      });
      await tx.insert(schema.installment).values({
        tenantId: TENANT_ID,
        creditId,
        seq: 1,
        dueDate: '2026-06-10',
        amountDueMinor: amount,
      });
      await tx.insert(schema.payment).values({
        id: paymentId,
        tenantId: TENANT_ID,
        payerPhone: '5511999999999',
        currency: 'BRL',
        amountMinor: amount,
        status: 'UNVERIFIED',
        creditId,
        receiverPixKey: fixture.pix.receiverPixKey,
        endToEndId: fixture.pix.endToEndId,
      });
    }

    // 4) Créditos reales del settlement_report sintético ya ingeridos (ground truth).
    const credits = parseSettlementCsv(SETTLEMENT_REPORT_CSV).filter(
      isEligiblePixCredit,
    );
    for (const credit of credits) {
      await tx.insert(schema.incomingCredit).values({
        tenantId: TENANT_ID,
        bankAccountId: MP_BANK_ACCOUNT_ID,
        sourceId: credit.sourceId,
        amountMinor: credit.amountMinor,
        netAmountMinor: credit.netAmountMinor,
        currency: credit.currency,
        paymentMethodType: credit.paymentMethodType,
        transactionType: credit.transactionType,
        settlementDate: new Date(credit.settlementDate),
      });
    }
  });

  console.log('✓ Seed Mercado Pago demo listo.');
  console.log(
    '  Banco MP + credenciales de ejemplo + comprobantes + créditos sembrados.',
  );
  console.log(
    '  Corré POST /payments/reconcile-settlement (x-tenant-id de la tenant demo):',
  );
  console.log(
    '    → "valido" y "monto_matchea" → CONFIRMED; "monto_sin_match" → UNCONFIRMED.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
