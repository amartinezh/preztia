import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@preztiaos/db';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  telegramChannelId,
  type OperationalSettings,
} from '@preztiaos/domain';
import { hashPassword } from '../../src/auth/password';
import { encryptSecret } from '../../src/shared/secret-cipher';
import type { TenantContext } from './context';
import { CITIES, generateCnpj } from './fake-data';
import type { BoxState, Row, UserRef, ZoneRef } from './model';
import {
  extraUsersFor,
  type PreservedBankAccount,
  type PreservedState,
} from './preserve';
import type { BankAccountSpec, BoxSpec, TenantScenario } from './scenario';

// ESTRUCTURA de cada tenant (configuración, no transacciones): tenant, ajustes, zonas,
// coordinadores, usuarios, planes, catálogo KYC, cuentas bancarias con sus credenciales, cajas y
// canales de mensajería. Lo real que se conservó (secretos, canales, contraseñas) tiene prioridad.

export interface StructureInput {
  readonly ctx: TenantContext;
  readonly preserved: PreservedState;
  readonly password: string;
  readonly resetPasswords: boolean;
  /** Instante en que "se configuró" el tenant (antes de la historia simulada). */
  readonly setupAt: Date;
  /** Primer día liquidable (fecha de inicio de la liquidación). */
  readonly settlementStartDate: string | null;
}

export async function seedStructure(input: StructureInput): Promise<void> {
  const { ctx } = input;
  await ctx.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await insertTenant(db, input);
    await insertZones(db, input);
    await insertUsers(db, input);
    await insertPlans(db, input);
    await insertDocumentCatalog(db, input);
    await insertBankAccountsAndBoxes(db, input);
    await insertChannels(db, input);
    await insertTenantConfig(db, input);
  });
}

async function insertTenant(
  db: Db,
  { ctx, preserved, setupAt }: StructureInput,
): Promise<void> {
  const identity = preserved.tenants.get(ctx.tenantId);
  await db.insert(schema.tenant).values({
    id: ctx.tenantId,
    name: identity?.name ?? ctx.scenario.name,
    slug: identity?.slug ?? ctx.scenario.slug,
    status: ctx.scenario.status,
    createdAt: setupAt,
    updatedAt: setupAt,
  });
}

async function insertTenantConfig(
  db: Db,
  input: StructureInput,
): Promise<void> {
  const { ctx, preserved, setupAt } = input;
  const kept = preserved.configs.get(ctx.tenantId);
  const operational: OperationalSettings = {
    ...DEFAULT_OPERATIONAL_SETTINGS,
    ...ctx.scenario.operational,
    settlementStartDate: input.settlementStartDate,
  };
  ctx.settings = operational;
  const pixKey = [...ctx.accounts.values()].find(
    (a) => a.providerType === 'PICPAY',
  )?.pixKey;
  await db.insert(schema.tenantConfig).values({
    tenantId: ctx.tenantId,
    whatsappPhoneNumberId: kept?.whatsappPhoneNumberId ?? ctx.defaultChannel,
    knowledgeBase: kept?.knowledgeBase?.trim()
      ? kept.knowledgeBase
      : ctx.scenario.knowledgeBase,
    currency: ctx.currency,
    aiProvider: kept?.aiProvider ?? 'GEMINI',
    aiApiKey: kept?.aiApiKey ?? null,
    operationalSettings: operational,
    collectionReminderSettings: {
      ...ctx.scenario.reminder,
      pixKey: ctx.scenario.reminder.pixKey
        ? (pixKey ?? ctx.scenario.reminder.pixKey)
        : null,
    },
    clientLanguage: ctx.scenario.language,
    messagingChannels: ctx.scenario.messaging,
    createdAt: setupAt,
    updatedAt: setupAt,
  });
}

async function insertZones(
  db: Db,
  { ctx, setupAt }: StructureInput,
): Promise<void> {
  for (const spec of ctx.scenario.zones) {
    const zone: ZoneRef = {
      id: randomUUID(),
      key: spec.key,
      path: spec.path,
      name: spec.name,
      city: spec.city ? (CITIES[spec.city] ?? null) : null,
    };
    await db.insert(schema.zone).values({
      id: zone.id,
      tenantId: ctx.tenantId,
      parentZoneId: spec.parentKey ? ctx.zone(spec.parentKey).id : null,
      path: zone.path,
      name: zone.name,
      supportPhone: spec.supportPhone ?? null,
      commissionRatePerMille: spec.commission?.ratePerMille ?? null,
      commissionBase: spec.commission?.base ?? null,
      createdAt: setupAt,
    });
    ctx.zones.set(spec.key, zone);
  }
}

async function insertUsers(db: Db, input: StructureInput): Promise<void> {
  const { ctx, setupAt } = input;
  for (const spec of ctx.scenario.users) {
    const zonePaths = spec.zoneKeys.map((k) => ctx.zone(k).path);
    const row: Row<typeof schema.appUser> = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      email: spec.email,
      passwordHash: await passwordHashFor(input, spec.email),
      role: spec.role,
      zonePaths,
      active: spec.active ?? true,
      createdAt: setupAt,
      updatedAt: setupAt,
    };
    await db.insert(schema.appUser).values(row);
    const user: UserRef = {
      id: row.id,
      key: spec.key,
      email: spec.email,
      role: spec.role,
      zonePaths,
      row,
    };
    ctx.users.set(spec.key, user);
  }
  await insertPreservedUsers(db, input);
  for (const [coordinatorKey, zoneKey] of ctx.scenario.coordinatorZones) {
    await db.insert(schema.zoneCoordinator).values({
      tenantId: ctx.tenantId,
      zoneId: ctx.zone(zoneKey).id,
      coordinatorId: ctx.user(coordinatorKey).id,
    });
  }
}

/** Usuarios reales que el escenario no define: se conservan tal cual (rol, zonas, contraseña). */
async function insertPreservedUsers(
  db: Db,
  { ctx, preserved }: StructureInput,
): Promise<void> {
  const seeded = new Set(ctx.scenario.users.map((u) => u.email));
  for (const user of extraUsersFor(preserved, ctx.tenantId, seeded)) {
    await db.insert(schema.appUser).values({ ...user, id: randomUUID() });
  }
}

/** La contraseña que ya tenía el usuario se conserva; solo los nuevos reciben la del seed. */
export async function passwordHashFor(
  input: {
    preserved: PreservedState;
    password: string;
    resetPasswords: boolean;
  },
  email: string,
): Promise<string> {
  const existing = input.preserved.passwordHashes.get(email);
  if (existing && !input.resetPasswords) return existing;
  return hashPassword(input.password);
}

async function insertPlans(
  db: Db,
  { ctx, setupAt }: StructureInput,
): Promise<void> {
  for (const spec of ctx.scenario.plans) {
    const id = randomUUID();
    await db.insert(schema.paymentPlan).values({
      id,
      tenantId: ctx.tenantId,
      name: spec.name,
      installmentsCount: spec.installmentsCount,
      frequency: spec.frequency,
      interestPct: spec.interestPct,
      isActive: spec.isActive,
      isDefault: spec.isDefault ?? false,
      createdAt: setupAt,
      updatedAt: setupAt,
    });
    ctx.plans.set(spec.key, {
      id,
      key: spec.key,
      name: spec.name,
      installmentsCount: spec.installmentsCount,
      frequency: spec.frequency,
      interestPct: spec.interestPct,
      isActive: spec.isActive,
    });
  }
}

async function insertDocumentCatalog(
  db: Db,
  { ctx, setupAt }: StructureInput,
): Promise<void> {
  await db.insert(schema.creditDocumentRequirement).values(
    ctx.scenario.documents.map((doc, index) => ({
      tenantId: ctx.tenantId,
      documentKey: doc.key,
      title: doc.title,
      description: doc.description,
      sortOrder: index + 1,
      expectedFiles: doc.expectedFiles ?? 1,
      active: doc.active ?? true,
      createdAt: setupAt,
      updatedAt: setupAt,
    })),
  );
}

async function insertBankAccountsAndBoxes(
  db: Db,
  input: StructureInput,
): Promise<void> {
  const { ctx, preserved } = input;
  const kept = preserved.bankAccounts.filter(
    (a) => a.account.tenantId === ctx.tenantId,
  );
  for (const spec of ctx.scenario.bankAccounts) {
    const real = kept.find((a) => a.account.bankCode === spec.bankCode);
    await insertBankAccount(db, input, spec, real);
  }
  // Cuentas reales que el escenario no define: se conservan con una caja bancaria propia.
  for (const real of kept.filter(
    (a) =>
      !ctx.scenario.bankAccounts.some((s) => s.bankCode === a.account.bankCode),
  )) {
    await insertBankAccount(db, input, specFromPreserved(real), real);
  }
  const boxes: readonly BoxSpec[] = [
    ...ctx.scenario.boxes,
    ...[...ctx.accounts.values()]
      .filter(
        (a) => !ctx.scenario.boxes.some((b) => b.bankAccountKey === a.key),
      )
      .map((a) => ({
        key: `bank-${a.key}`,
        type: 'BANK' as const,
        name: a.key,
        bankAccountKey: a.key,
      })),
  ];
  for (const spec of boxes) await insertBox(db, input, spec);
}

async function insertBankAccount(
  db: Db,
  { ctx, setupAt }: StructureInput,
  spec: BankAccountSpec,
  real: PreservedBankAccount | undefined,
): Promise<void> {
  const id = randomUUID();
  const pixKey = real?.account.pixKey ?? spec.pixKey;
  const receiverName = real?.account.receiverName ?? spec.receiverName;
  await db.insert(schema.tenantBankAccount).values({
    id,
    tenantId: ctx.tenantId,
    label: real?.account.label ?? spec.label,
    bankName: real?.account.bankName ?? spec.bankName,
    accountNumber: real?.account.accountNumber ?? spec.accountNumber,
    countryCode: spec.countryCode,
    bankCode: spec.bankCode,
    providerType: real?.account.providerType ?? spec.providerType,
    pixKey,
    receiverTaxId:
      real?.account.receiverTaxId ??
      (receiverName ? generateCnpj(ctx.random) : null),
    receiverName,
    apiKey:
      real?.account.apiKey ?? (spec.apiKey ? encryptSecret(spec.apiKey) : null),
    reportConfig: real?.account.reportConfig ?? spec.reportConfig ?? null,
    unverifiedPolicy: spec.unverifiedPolicy,
    verifyPaymentsEnabled: spec.verifyPaymentsEnabled,
    balanceCheckEnabled: spec.balanceCheckEnabled,
    active: true,
    createdAt: setupAt,
    updatedAt: setupAt,
  });
  const credentials = real
    ? real.credentials.map((c) => ({
        name: c.name,
        valueEncrypted: c.valueEncrypted,
      }))
    : Object.entries(spec.credentials ?? {}).map(([name, value]) => ({
        name,
        valueEncrypted: encryptSecret(value),
      }));
  if (credentials.length > 0) {
    await db.insert(schema.bankCredential).values(
      credentials.map((c) => ({
        ...c,
        tenantId: ctx.tenantId,
        bankAccountId: id,
        createdAt: setupAt,
        updatedAt: setupAt,
      })),
    );
  }
  ctx.accounts.set(spec.key, {
    id,
    key: spec.key,
    bankCode: spec.bankCode,
    providerType: spec.providerType,
    pixKey,
    receiverName,
  });
}

function specFromPreserved(real: PreservedBankAccount): BankAccountSpec {
  const a = real.account;
  return {
    key: a.bankCode.toLowerCase(),
    label: a.label,
    bankName: a.bankName,
    accountNumber: a.accountNumber ?? '',
    countryCode: a.countryCode,
    bankCode: a.bankCode,
    providerType: a.providerType,
    pixKey: a.pixKey,
    receiverName: a.receiverName,
    unverifiedPolicy: a.unverifiedPolicy,
    verifyPaymentsEnabled: a.verifyPaymentsEnabled,
    balanceCheckEnabled: a.balanceCheckEnabled,
  };
}

async function insertBox(
  db: Db,
  { ctx, setupAt }: StructureInput,
  spec: BoxSpec,
): Promise<void> {
  const zone = spec.zoneKey ? ctx.zone(spec.zoneKey) : null;
  const account = spec.bankAccountKey ? ctx.account(spec.bankAccountKey) : null;
  const row: Row<typeof schema.cashBox> = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    type: spec.type,
    name: spec.name,
    currency: ctx.currency,
    bankAccountId: account?.id ?? null,
    assignedTo: spec.assignedToKey ? ctx.user(spec.assignedToKey).id : null,
    zoneId: zone?.id ?? null,
    active: spec.active ?? true,
    createdAt: setupAt,
    updatedAt: setupAt,
  };
  await db.insert(schema.cashBox).values(row);
  const box: BoxState = {
    id: row.id,
    key: spec.key,
    type: spec.type,
    name: spec.name,
    currency: ctx.currency,
    zoneId: zone?.id ?? null,
    zonePath: zone?.path ?? null,
    assignedTo: row.assignedTo ?? null,
    bankAccountId: account?.id ?? null,
    pixKey: account?.pixKey ?? null,
    row,
    balance: 0,
  };
  ctx.boxes.set(spec.key, box);
}

/**
 * Canales de mensajería: los reales se conservan (con sus credenciales cifradas) en la zona de
 * igual ruta; solo si el tenant no tenía ninguno se crean los de demostración.
 */
async function insertChannels(db: Db, input: StructureInput): Promise<void> {
  const { ctx, preserved, setupAt } = input;
  const realWhatsapp = preserved.whatsapp.filter(
    (c) => c.tenantId === ctx.tenantId,
  );
  const realTelegram = preserved.telegram.filter(
    (c) => c.tenantId === ctx.tenantId,
  );
  const fallbackZone =
    [...ctx.zones.values()].find((z) => z.city) ?? [...ctx.zones.values()][0];
  if (!fallbackZone) return;
  const zoneByPath = (path: string) =>
    [...ctx.zones.values()].find((z) => z.path === path) ?? fallbackZone;

  if (realWhatsapp.length > 0) {
    for (const channel of realWhatsapp) {
      const zone = zoneByPath(channel.zonePath);
      await db.insert(schema.whatsappChannel).values({
        ...channel,
        id: randomUUID(),
        zoneId: zone.id,
        zonePath: zone.path,
      });
      ctx.channelByZone.set(zone.path, channel.phoneNumberId);
      ctx.zonePathByChannel.set(channel.phoneNumberId, zone.path);
    }
  } else {
    for (const demo of ctx.scenario.demoWhatsapp) {
      const zone = ctx.zone(demo.zoneKey);
      await db.insert(schema.whatsappChannel).values({
        tenantId: ctx.tenantId,
        phoneNumberId: demo.phoneNumberId,
        zoneId: zone.id,
        zonePath: zone.path,
        graphVersion: 'v21.0',
        createdAt: setupAt,
      });
      ctx.channelByZone.set(zone.path, demo.phoneNumberId);
      ctx.zonePathByChannel.set(demo.phoneNumberId, zone.path);
    }
  }

  if (realTelegram.length > 0) {
    for (const bot of realTelegram) {
      const zone = zoneByPath(bot.zonePath);
      await db.insert(schema.telegramChannel).values({
        ...bot,
        id: randomUUID(),
        zoneId: zone.id,
        zonePath: zone.path,
      });
      ctx.telegramChannel = bot.channelId;
      ctx.zonePathByChannel.set(bot.channelId, zone.path);
      if (!ctx.channelByZone.has(zone.path))
        ctx.channelByZone.set(zone.path, bot.channelId);
    }
  } else if (ctx.scenario.demoTelegram) {
    const demo = ctx.scenario.demoTelegram;
    const zone = ctx.zone(demo.zoneKey);
    const channelId = telegramChannelId(demo.botId);
    await db.insert(schema.telegramChannel).values({
      tenantId: ctx.tenantId,
      botId: demo.botId,
      channelId,
      botUsername: demo.username,
      zoneId: zone.id,
      zonePath: zone.path,
      botToken: encryptSecret(`${demo.botId}:AAEdemo-token-solo-para-pruebas`),
      webhookHookId: randomUUID().replace(/-/g, ''),
      webhookSecret: encryptSecret(`demo-secret-${demo.botId}`),
      // Sin registrar: un bot de demostración nunca recibe mensajes reales.
      webhookRegisteredAt: null,
      createdAt: setupAt,
    });
    ctx.telegramChannel = channelId;
    ctx.zonePathByChannel.set(channelId, zone.path);
    if (!ctx.channelByZone.has(zone.path))
      ctx.channelByZone.set(zone.path, channelId);
  }

  ctx.defaultChannel =
    preserved.configs.get(ctx.tenantId)?.whatsappPhoneNumberId ??
    realWhatsapp[0]?.phoneNumberId ??
    ctx.scenario.demoWhatsapp[0]?.phoneNumberId ??
    null;
}
