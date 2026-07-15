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

// Teléfono de atención al cliente de las zonas (se comparte con el cliente ante inconvenientes).
// Configurable por env; el mismo número se siembra en ambas zonas de demo (puede repetirse).
const SUPPORT_PHONE = process.env.SEED_SUPPORT_PHONE ?? '+55 11 4000-0000';

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
        knowledgeBase: `
  # Base de Conocimiento: Línea de Crédito Comercial "Rápido, Fácil e Seguro"
  
  ## 1. Información General del Producto
  * **Descripción:** Préstamos comerciales dirigidos a emprendedores y negocios que no reciben apoyo de la banca tradicional ("O banco não te socorre?").
  * **Público Objetivo:** Exclusivo para propietarios de tiendas y negocios ("Exclusivo para proprietários de loja").
  * **Promesa de Valor:** Un préstamo rápido, fácil y seguro ("rápido, fácil e seguro").
  * **Canal de Contacto Principal:** WhatsApp: (37) 99968-5759.
  
  ## 2. Requisitos y Proceso de Verificación
  Para procesar la solicitud de crédito, el cliente debe cumplir con los siguientes requisitos documentales y de ubicación:
  
  * **Documentos Obligatorios:**
    1. Documento de identidad (Cédula).
    2. Registro mercantil del negocio.
    3. Recibo de servicios públicos.
  * **Verificación de Ubicación en Tiempo Real:** 
    * Al momento de elevar la solicitud, el cliente **debe encontrarse físicamente en su negocio o en su casa**.
    * El sistema o agente solicitará que comparta su **ubicación en tiempo real** a través de WhatsApp.
  * **Validación Fotográfica:** Se exigirá el envío de una **fotografía del lugar** (negocio o domicilio) en el momento de la solicitud para realizar verificaciones antifraude y de existencia.
  
  ## 3. Tablas de Amortización y Planes de Pago
  
  A continuación, se detallan los planes de pago según el valor del préstamo solicitado. Todos los valores están expresados en Reales Brasileños (R$).
  
  * **Planes Oficiales:** 11, 20 y 24 parcelas (cuotas).
  * **Planes de Prueba (Ficticios):** 10 y 15 parcelas (cuotas creadas para el entorno de pruebas del sistema).
  
  | Valor do Empréstimo | 10 parcelas (Ficticio) | 11 parcelas (Oficial) | 15 parcelas (Ficticio) | 20 parcelas (Oficial) | 24 parcelas (Oficial) |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | **R$ 200,00** | R$ 22,00 | R$ 20,00 | R$ 16,00 | R$ 12,00 | R$ 10,00 |
  | **R$ 300,00** | R$ 33,00 | R$ 30,00 | R$ 24,00 | R$ 18,00 | R$ 15,00 |
  | **R$ 400,00** | R$ 44,00 | R$ 40,00 | R$ 32,00 | R$ 24,00 | R$ 20,00 |
  | **R$ 500,00** | R$ 55,00 | R$ 50,00 | R$ 40,00 | R$ 30,00 | R$ 25,00 |
  | **R$ 600,00** | R$ 66,00 | R$ 60,00 | R$ 48,00 | R$ 36,00 | R$ 30,00 |
  | **R$ 700,00** | R$ 77,00 | R$ 70,00 | R$ 56,00 | R$ 42,00 | R$ 35,00 |
  | **R$ 800,00** | R$ 88,00 | R$ 80,00 | R$ 64,00 | R$ 48,00 | R$ 40,00 |
  | **R$ 1.000,00** | R$ 110,00 | R$ 100,00 | R$ 80,00 | R$ 60,00 | R$ 50,00 |
  | **R$ 2.000,00** | R$ 220,00 | R$ 200,00 | R$ 160,00 | R$ 120,00 | R$ 100,00 |
  | **R$ 3.000,00** | R$ 330,00 | R$ 300,00 | R$ 240,00 | R$ 180,00 | R$ 150,00 |
  
  ## 4. Notas para el Agente (Chatbot)
  * **Restricciones de Solicitud:** Si el usuario no es dueño de un negocio o tienda, debes informarle amablemente que este crédito es exclusivo para propietarios de negocios.
  * **Control de Requisitos:** Antes de confirmar cualquier crédito, debes asegurarte de pedir explícitamente los 3 documentos (Cédula, Registro mercantil, Recibo de servicios públicos).
  * **Control de Ubicación:** Debes indicar claramente al usuario: "Para continuar con tu solicitud, por favor envíame tu ubicación en tiempo real y una foto del lugar. Recuerda que debes estar en tu negocio o en tu casa en este momento". Si el usuario se niega o no puede enviar la ubicación/foto, el proceso no puede continuar.
  * **Montos:** El préstamo mínimo es de R$ 200,00 y el máximo listado es de R$ 3.000,00.
  * **Redirección a Ventas/Validación:** Si se completan los pasos o si hay dudas fuera de este flujo, redirige la solicitud o transfiere al agente humano en el WhatsApp oficial: (37) 99968-5759.`,
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
        documentKey: 'BUSINESS_PHOTO',
        title: 'Envía una foto clara y actual de la fachada o interior de tu negocio.',
        description:
          'Foto del local (rótulo, mostrador o interior) tomada hoy; sirve para verificar el negocio.',
        sortOrder: 3,
      },
      {
        tenantId: TENANT_ID,
        documentKey: 'PUBLIC_SERVICES_RECEIPT',
        title: 'Envía un recibo de servicios públicos reciente.',
        description: 'Recibo de agua, luz o gas con la dirección visible.',
        sortOrder: 4,
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
    // El `supportPhone` es el número de atención al cliente de la zona (se comparte con el cliente
    // ante inconvenientes); aquí ambas zonas usan el MISMO número de ejemplo a propósito, para
    // mostrar que un número puede repetirse entre zonas. Se edita en el panel Zonas.
    await tx.insert(schema.zone).values([
      {
        id: ZONE_ROOT_ID,
        tenantId: TENANT_ID,
        parentZoneId: null,
        path: 'antioquia',
        name: 'Antioquia',
        supportPhone: SUPPORT_PHONE,
      },
      {
        id: ids.zoneChild,
        tenantId: TENANT_ID,
        parentZoneId: ZONE_ROOT_ID,
        path: 'antioquia.medellin',
        name: 'Medellín',
        supportPhone: SUPPORT_PHONE,
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
