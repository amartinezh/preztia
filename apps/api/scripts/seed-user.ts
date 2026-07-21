import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Carga el .env de la raíz del monorepo (igual que src/env.ts).
config({ path: resolve(__dirname, '../../../.env') });

import { sql } from 'drizzle-orm';
import { createDb, schema } from '@preztiaos/db';
import { hashPassword } from '../src/auth/password';

/**
 * Seed ORDENADO y completo: LIMPIA toda la base (TRUNCATE de todas las tablas de `public`,
 * conservando esquema, roles y migraciones) y crea un registro inicial en toda la cadena IAM
 * + cartera para poder ingresar y verificar con TODOS los roles:
 *
 *   1. Tenant "Preztia tenant" (+ tenant_config con canal de WhatsApp de prueba)
 *   1c. Plan de pago por defecto (20 cuotas diarias · 20%)
 *   2. SUPER_ADMIN (plano de control, sin tenant)
 *   3. ADMIN del tenant
 *   4. Árbol de zonas (Antioquia → Medellín)
 *   5. COORDINATOR (alcance: antioquia) + asignación a la zona raíz
 *   6. COLLECTOR (alcance: antioquia.medellin) con UN PAR de clientes asignados
 *   7. Dos deudores (clientes) con geo, contacto y crédito: uno al día y otro en mora
 *      (cuotas vencidas ≥ umbral por defecto), para poder probar "Visitas" recién sembrado
 *   8. Asignación cobrador → cada cliente
 *
 * Usa DATABASE_URL (superusuario, que bypassa RLS). Idempotente y repetible.
 */

// Identificadores estables (coinciden con las variables de la colección Postman).
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ZONE_ROOT_ID = '22222222-2222-4222-8222-222222222222';
const BORROWER_ID = '11111111-1111-4111-8111-111111111111';
// Segundo cliente del cobrador (en mora), para que "Visitas → Por visitar" no quede vacío.
const BORROWER_ID_2 = '11111111-1111-4111-8111-111111111112';

const TENANT_NAME = 'Preztia tenant';
const TENANT_SLUG = 'preztia-tenant';
const APPLICANT_PHONE = '5561999998888';
const APPLICANT_PHONE_2 = '5561999997777';
const WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
const CURRENCY = process.env.CREDIT_CURRENCY ?? 'COP';

const SUPER_ADMIN = { email: 'super@preztia.test', password: 'changeme-super-123' };
const ADMIN = { email: 'admin@preztia.test', password: 'changeme-123' };
const COORDINATOR = { email: 'coord1@preztia.test', password: 'changeme-123' };
const COLLECTOR = { email: 'cob1@preztia.test', password: 'changeme-123' };

function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurado');
  const db = createDb(databaseUrl);

  // 0) LIMPIEZA: vacía todas las tablas de `public` (conserva esquema/roles/migraciones).
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
    credit: randomUUID(),
    credit2: randomUUID(),
    paymentPlan: randomUUID(),
  };

  const [superHash, adminHash, coordHash, collectorHash] = await Promise.all([
    hashPassword(SUPER_ADMIN.password),
    hashPassword(ADMIN.password),
    hashPassword(COORDINATOR.password),
    hashPassword(COLLECTOR.password),
  ]);

  await db.transaction(async (tx) => {
    // 1) Tenant + configuración (canal de WhatsApp de prueba).
    await tx
      .insert(schema.tenant)
      .values({ id: TENANT_ID, name: TENANT_NAME, slug: TENANT_SLUG });
    await tx.insert(schema.tenantConfig).values({
      tenantId: TENANT_ID,
      whatsappPhoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      knowledgeBase:
        'Preztia tenant: crédito de ruta. Cuotas diarias. Requisitos: documento de identidad, registro del negocio y recibo de servicio público.',
      aiProvider: 'GEMINI',
    });

    // 1b) Catálogo de documentos requeridos: lo que el bot pide al iniciar una solicitud.
    // Sin estas filas, el flujo "credit_application" no tiene nada que pedir y no responde.
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

    // 1c) Plan de pago por defecto: sin él, "Ofertar planes" responde 409 (NO_DEFAULT_PLAN).
    //     Gota a gota típico: 20 cuotas diarias al 20% (interés en base-mil: 200 = 20%).
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

    // 2-3) Usuarios: SUPER_ADMIN (sin tenant) y ADMIN (del tenant).
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

    // 4) Árbol de zonas: Antioquia (raíz) → Medellín (hija).
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

    // 5) Coordinador asignado a la zona raíz.
    await tx.insert(schema.zoneCoordinator).values({
      tenantId: TENANT_ID,
      zoneId: ZONE_ROOT_ID,
      coordinatorId: ids.coordinator,
    });

    // 6b) Clientes (deudores) con identidad y geo: el mapa/"Visitas" los necesita con
    //     coordenadas. Cliente 1 al día; cliente 2 en mora, para poblar de una vez la
    //     pestaña "Visitas → Por visitar" del cobrador recién sembrado.
    await tx.insert(schema.borrower).values([
      {
        id: BORROWER_ID,
        tenantId: TENANT_ID,
        nationalId: '1017000001',
        firstName: 'Carlos',
        lastName: 'Restrepo',
        business: 'Tienda La Esquina',
        phone: APPLICANT_PHONE,
        lat: 6.2442,
        lng: -75.5812,
      },
      {
        id: BORROWER_ID_2,
        tenantId: TENANT_ID,
        nationalId: '1017000002',
        firstName: 'Marta',
        lastName: 'Gómez',
        business: 'Peluquería Marta',
        phone: APPLICANT_PHONE_2,
        lat: 6.2308,
        lng: -75.5906,
      },
    ]);

    // 7) Contacto de WhatsApp + crédito con cronograma de cada cliente.
    await tx.insert(schema.borrowerContact).values([
      {
        tenantId: TENANT_ID,
        borrowerId: BORROWER_ID,
        phone: APPLICANT_PHONE,
        channelId: WHATSAPP_PHONE_NUMBER_ID,
      },
      {
        tenantId: TENANT_ID,
        borrowerId: BORROWER_ID_2,
        phone: APPLICANT_PHONE_2,
        channelId: WHATSAPP_PHONE_NUMBER_ID,
      },
    ]);
    await tx.insert(schema.credit).values([
      {
        id: ids.credit,
        tenantId: TENANT_ID,
        borrowerId: BORROWER_ID,
        zoneId: ids.zoneChild,
        principalMinor: 90000,
        interestPct: 0,
        installmentsCount: 3,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: today(0),
        endDate: today(2),
        status: 'ACTIVE',
      },
      {
        // EN MORA a propósito: 4 cuotas diarias ya vencidas y sin abonar (≥ umbral por
        // defecto de 3), para que el cobrador vea a este cliente en "Visitas → Por visitar".
        id: ids.credit2,
        tenantId: TENANT_ID,
        borrowerId: BORROWER_ID_2,
        zoneId: ids.zoneChild,
        principalMinor: 120000,
        interestPct: 0,
        installmentsCount: 4,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: today(-4),
        endDate: today(-1),
        status: 'ACTIVE',
      },
    ]);
    await tx.insert(schema.installment).values([
      ...[0, 1, 2].map((i) => ({
        tenantId: TENANT_ID,
        creditId: ids.credit,
        seq: i + 1,
        dueDate: today(i),
        amountDueMinor: 30000,
      })),
      ...[0, 1, 2, 3].map((i) => ({
        tenantId: TENANT_ID,
        creditId: ids.credit2,
        seq: i + 1,
        dueDate: today(i - 4),
        amountDueMinor: 30000,
        status: 'OVERDUE' as const,
      })),
    ]);

    // 8) Asignación cobrador → cada cliente (el cobrador solo verá estos dos clientes).
    await tx.insert(schema.collectorClient).values([
      {
        tenantId: TENANT_ID,
        collectorId: ids.collector,
        borrowerId: BORROWER_ID,
        assignedBy: ids.coordinator,
      },
      {
        tenantId: TENANT_ID,
        collectorId: ids.collector,
        borrowerId: BORROWER_ID_2,
        assignedBy: ids.coordinator,
      },
    ]);
  });

  await db.$client.end();

  // Resumen legible de credenciales.
  const line = (role: string, email: string, password: string, extra = '') =>
    `  ${role.padEnd(13)} ${email.padEnd(22)} ${password.padEnd(20)} ${extra}`;
  console.log('\n✅ Base limpiada y sembrada.\n');
  console.log(`Tenant: "${TENANT_NAME}" (slug: ${TENANT_SLUG})`);
  console.log(`  id (x-tenant-id): ${TENANT_ID}\n`);
  console.log('Usuarios (POST /auth/login { email, password }):');
  console.log(`  ${'ROL'.padEnd(13)} ${'EMAIL'.padEnd(22)} ${'CONTRASEÑA'.padEnd(20)} ALCANCE`);
  console.log(line('SUPER_ADMIN', SUPER_ADMIN.email, SUPER_ADMIN.password, '(plano de control · sin tenant)'));
  console.log(line('ADMIN', ADMIN.email, ADMIN.password, '(todo el tenant)'));
  console.log(line('COORDINATOR', COORDINATOR.email, COORDINATOR.password, 'zonas: antioquia'));
  console.log(line('COLLECTOR', COLLECTOR.email, COLLECTOR.password, 'zonas: antioquia.medellin · 2 clientes asignados'));
  console.log('\nDatos de verificación:');
  console.log(`  Zonas: antioquia (raíz) → antioquia.medellin`);
  console.log(`  Cliente 1 (al día): Carlos Restrepo, crédito ACTIVO de 90000 (${CURRENCY}) con 3 cuotas; deudor ${BORROWER_ID}`);
  console.log(`  Cliente 2 (en mora): Marta Gómez, crédito ACTIVO de 120000 (${CURRENCY}) con 4 cuotas VENCIDAS; deudor ${BORROWER_ID_2}`);
  console.log('    → visible en la app del cobrador, pestaña "Visitas → Por visitar"');
  console.log('  Plan de pago por defecto: "20 días · 20%" (20 cuotas diarias, 20% de interés)');
  console.log('\nNota: el SUPER_ADMIN NO envía x-tenant-id; los demás roles usan el x-tenant-id de arriba.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
