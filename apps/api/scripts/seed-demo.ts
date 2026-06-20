import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Carga el .env de la raíz del monorepo (igual que src/env.ts y seed-user.ts).
config({ path: resolve(__dirname, '../../../.env') });

import { eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@preztiaos/db';
import { hashPassword } from '../src/auth/password';
import { encryptSecret, decryptSecret } from '../src/shared/secret-cipher';

/**
 * Seed de DEMO para pruebas aisladas end-to-end (ambiente de prueba):
 *
 *   - LIMPIA toda la base (TRUNCATE de `public`, conserva esquema/roles/migraciones).
 *   - NO pre-siembra deudor/crédito: el flujo de WhatsApp arranca LIMPIO (solicitud → docs →
 *     revisión → registrar crédito), luego se ingresa el pago por imagen y se hace efectivo.
 *   - Conserva el número de WhatsApp y la credencial de IA que la tenant tenía configurados
 *     (los lee ANTES de truncar). Permite override por env SEED_WHATSAPP_PHONE_NUMBER_ID.
 *   - Siembra: tenant + config (moneda del tenant), catálogo de documentos, usuarios de todos
 *     los roles, árbol de zonas, UNA cuenta bancaria Inter (BR) y UNA caja de CADA tipo
 *     (CASH / BANK / TRANSIT). La caja BANK queda vinculada a la cuenta Inter.
 *
 * Secretos (ai_api_key, api_key bancaria) se guardan CIFRADOS en reposo (AES-256-GCM).
 * Usa DATABASE_URL (superusuario, bypassa RLS). Idempotente y repetible.
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ZONE_ROOT_ID = '22222222-2222-4222-8222-222222222222';

const TENANT_NAME = 'Preztia tenant';
const TENANT_SLUG = 'preztia-tenant';
const DEFAULT_WHATSAPP_PHONE_NUMBER_ID = '1108588789011965';

// Inter es banco de Brasil → PIX en BRL. Configurable por env.
const CURRENCY = process.env.SEED_CURRENCY ?? 'BRL';

// Cuenta bancaria Inter (BR). La llave PIX es la "recaudadora": un comprobante cuyo
// receiver_pix_key coincida con ésta se rutea AUTOMÁTICAMENTE a la caja bancaria.
const INTER_PIX_KEY = 'tesouraria@preztia.com.br';
const INTER_API_KEY = 'INTER_SANDBOX_API_KEY_REPLACE_ME';

const SUPER_ADMIN = { email: 'super@preztia.test', password: 'changeme-super-123' };
const ADMIN = { email: 'admin@preztia.test', password: 'changeme-123' };
const COORDINATOR = { email: 'coord1@preztia.test', password: 'changeme-123' };
const COLLECTOR = { email: 'cob1@preztia.test', password: 'changeme-123' };

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurado');
  const db = createDb(databaseUrl);

  // 0) Conserva el número de WhatsApp y la credencial de IA que ya estaban funcionando
  //    (se leen ANTES de truncar). `decryptSecret` tolera valores legados en texto plano.
  const [previous] = await db
    .select({
      wa: schema.tenantConfig.whatsappPhoneNumberId,
      ai: schema.tenantConfig.aiApiKey,
    })
    .from(schema.tenantConfig)
    .where(eq(schema.tenantConfig.tenantId, TENANT_ID))
    .limit(1);

  const whatsappPhoneNumberId =
    process.env.SEED_WHATSAPP_PHONE_NUMBER_ID ??
    previous?.wa ??
    DEFAULT_WHATSAPP_PHONE_NUMBER_ID;
  const aiApiKeyPlain = previous?.ai ? decryptSecret(previous.ai) : null;

  // 0b) LIMPIEZA: vacía todas las tablas de `public` (conserva esquema/roles/migraciones).
  await db.execute(sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);

  const ids = {
    superAdmin: randomUUID(),
    admin: randomUUID(),
    coordinator: randomUUID(),
    collector: randomUUID(),
    zoneChild: randomUUID(),
    bankAccount: randomUUID(),
    cashBox: randomUUID(),
    bankBox: randomUUID(),
    transitBox: randomUUID(),
    paymentPlan: randomUUID(),
    whatsappChannel: randomUUID(),
  };

  const [superHash, adminHash, coordHash, collectorHash] = await Promise.all([
    hashPassword(SUPER_ADMIN.password),
    hashPassword(ADMIN.password),
    hashPassword(COORDINATOR.password),
    hashPassword(COLLECTOR.password),
  ]);

  await db.transaction(async (tx) => {
    // 1) Tenant + configuración (número de WhatsApp conservado + moneda + IA cifrada).
    await tx
      .insert(schema.tenant)
      .values({ id: TENANT_ID, name: TENANT_NAME, slug: TENANT_SLUG });
    await tx.insert(schema.tenantConfig).values({
      tenantId: TENANT_ID,
      whatsappPhoneNumberId,
      currency: CURRENCY,
      knowledgeBase:
        'Preztia tenant: crédito de ruta. Cuotas diarias. Requisitos: documento de identidad, registro del negocio y recibo de servicio público.',
      aiProvider: 'GEMINI',
      ...(aiApiKeyPlain ? { aiApiKey: encryptSecret(aiApiKeyPlain) } : {}),
    });

    // 1b) Catálogo de documentos requeridos: lo que el bot pide al iniciar la solicitud.
    await tx.insert(schema.creditDocumentRequirement).values([
      {
        tenantId: TENANT_ID,
        documentKey: 'IDENTITY_DOCUMENT',
        title: 'Envía una foto de tu documento de identidad (ambos lados).',
        description: 'Cédula o identificación oficial con foto, legible.',
        sortOrder: 1,
      },
      {
        tenantId: TENANT_ID,
        documentKey: 'BUSINESS_VALIDITY_CERTIFICATE',
        title: 'Envía el registro o certificado de tu negocio.',
        description: 'Documento que acredita el negocio (cámara de comercio, RUT o similar).',
        sortOrder: 2,
      },
      {
        tenantId: TENANT_ID,
        documentKey: 'PUBLIC_SERVICES_RECEIPT',
        title: 'Envía un recibo de servicios públicos reciente.',
        description: 'Recibo de agua, luz o gas con la dirección visible.',
        sortOrder: 3,
      },
    ]);

    // 2-3) Usuarios de todos los roles (para login y revisión).
    await tx.insert(schema.appUser).values([
      {
        id: ids.superAdmin,
        tenantId: null,
        email: SUPER_ADMIN.email,
        passwordHash: superHash,
        role: 'SUPER_ADMIN',
        zonePaths: [],
      },
      {
        id: ids.admin,
        tenantId: TENANT_ID,
        email: ADMIN.email,
        passwordHash: adminHash,
        role: 'ADMIN',
        zonePaths: [],
      },
      {
        id: ids.coordinator,
        tenantId: TENANT_ID,
        email: COORDINATOR.email,
        passwordHash: coordHash,
        role: 'COORDINATOR',
        zonePaths: ['antioquia'],
      },
      {
        id: ids.collector,
        tenantId: TENANT_ID,
        email: COLLECTOR.email,
        passwordHash: collectorHash,
        role: 'COLLECTOR',
        zonePaths: ['antioquia.medellin'],
      },
    ]);

    // 4) Árbol de zonas (raíz → hija): el ADMIN asigna la zona al aprobar la solicitud.
    await tx.insert(schema.zone).values([
      {
        id: ZONE_ROOT_ID,
        tenantId: TENANT_ID,
        parentZoneId: null,
        path: 'antioquia',
        name: 'Antioquia',
      },
      {
        id: ids.zoneChild,
        tenantId: TENANT_ID,
        parentZoneId: ZONE_ROOT_ID,
        path: 'antioquia.medellin',
        name: 'Medellín',
      },
    ]);
    await tx.insert(schema.zoneCoordinator).values({
      tenantId: TENANT_ID,
      zoneId: ZONE_ROOT_ID,
      coordinatorId: ids.coordinator,
    });

    // 5) Cuenta bancaria Inter (BR). La api_key va CIFRADA en reposo.
    await tx.insert(schema.tenantBankAccount).values({
      id: ids.bankAccount,
      tenantId: TENANT_ID,
      label: 'Inter Principal',
      bankName: 'Banco Inter',
      accountNumber: '0001-12345-6',
      countryCode: 'BR',
      bankCode: 'INTER',
      pixKey: INTER_PIX_KEY,
      apiKey: encryptSecret(INTER_API_KEY),
      unverifiedPolicy: 'HOLD',
    });

    // 6) Una caja de CADA tipo. La BANK queda vinculada a la cuenta Inter (CHECK en BD).
    await tx.insert(schema.cashBox).values([
      {
        id: ids.cashBox,
        tenantId: TENANT_ID,
        type: 'CASH',
        name: 'Caja Menor',
        currency: CURRENCY,
      },
      {
        id: ids.bankBox,
        tenantId: TENANT_ID,
        type: 'BANK',
        name: 'Caja Inter',
        currency: CURRENCY,
        bankAccountId: ids.bankAccount,
      },
      {
        id: ids.transitBox,
        tenantId: TENANT_ID,
        type: 'TRANSIT',
        name: 'Fondos en Tránsito',
        currency: CURRENCY,
      },
    ]);

    // 7) Plan de pago por defecto: sin él, "Ofertar planes" da 409 (no hay plan
    //    activo/por defecto que ofrecer). Gota a gota típico: 20 cuotas diarias al 20%
    //    (interés en base-mil: 200 = 20%).
    await tx.insert(schema.paymentPlan).values({
      id: ids.paymentPlan,
      tenantId: TENANT_ID,
      name: '20 días · 20%',
      installmentsCount: 20,
      frequency: 'DAILY',
      interestPct: 200,
      isActive: true,
      isDefault: true,
    });

    // 8) Canal de WhatsApp (Fase 9): mapea la línea del negocio → zona. Sin esta fila la
    //    zona NO se resuelve al aprobar ("No se pudo resolver la zona desde la línea de WhatsApp").
    //    El número se mapea a la zona hija (Medellín), dentro del alcance del coordinador.
    await tx.insert(schema.whatsappChannel).values({
      id: ids.whatsappChannel,
      tenantId: TENANT_ID,
      phoneNumberId: whatsappPhoneNumberId,
      zoneId: ids.zoneChild,
      zonePath: 'antioquia.medellin',
    });
  });

  await db.$client.end();

  const line = (role: string, email: string, password: string, extra = '') =>
    `  ${role.padEnd(13)} ${email.padEnd(22)} ${password.padEnd(20)} ${extra}`;
  console.log('\n✅ Base limpiada y sembrada (DEMO, ambiente de prueba).\n');
  console.log(`Tenant: "${TENANT_NAME}"  id (x-tenant-id): ${TENANT_ID}`);
  console.log(`  WhatsApp phone_number_id (conservado): ${whatsappPhoneNumberId}`);
  console.log(`  Moneda del tenant: ${CURRENCY}`);
  console.log(`  IA: ${aiApiKeyPlain ? 'credencial conservada y cifrada' : 'SIN credencial (configúrala para el OCR)'}\n`);
  console.log('Usuarios (POST /auth/login { email, password }):');
  console.log(line('SUPER_ADMIN', SUPER_ADMIN.email, SUPER_ADMIN.password, '(sin tenant)'));
  console.log(line('ADMIN', ADMIN.email, ADMIN.password, '(todo el tenant · revisa y crea crédito · gestiona caja)'));
  console.log(line('COORDINATOR', COORDINATOR.email, COORDINATOR.password, 'zonas: antioquia'));
  console.log(line('COLLECTOR', COLLECTOR.email, COLLECTOR.password, 'zonas: antioquia.medellin'));
  console.log('\nCaja y banca:');
  console.log(`  Cuenta Inter (BR) · pixKey recaudadora: ${INTER_PIX_KEY}`);
  console.log('  Cajas: "Caja Menor" (CASH) · "Caja Inter" (BANK→Inter) · "Fondos en Tránsito" (TRANSIT)');
  console.log('\nSin deudor/crédito pre-cargado: arranca el flujo de WhatsApp desde cero.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
