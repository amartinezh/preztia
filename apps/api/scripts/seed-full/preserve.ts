import { schema, type Db } from '@preztiaos/db';
import { SUPER_ADMIN_EMAIL, type TenantScenario } from './scenario';

// CONSERVACIÓN de lo que no es dato de prueba. Antes de vaciar la base se leen las credenciales
// reales (IA, WhatsApp, Telegram, bancos), la identidad de los tenants y las contraseñas de los
// usuarios; el seed las vuelve a escribir tal cual (los secretos siguen cifrados con la misma
// clave). Así correrlo en producción no rompe el bot ni los logins que ya funcionaban.

type UserRow = typeof schema.appUser.$inferSelect;
type WhatsappRow = typeof schema.whatsappChannel.$inferSelect;
type TelegramRow = typeof schema.telegramChannel.$inferSelect;
type BankAccountRow = typeof schema.tenantBankAccount.$inferSelect;
type CredentialRow = typeof schema.bankCredential.$inferSelect;

export interface PreservedConfig {
  readonly aiProvider: 'GEMINI' | 'OPENAI' | 'CLAUDE';
  readonly aiApiKey: string | null;
  readonly whatsappPhoneNumberId: string | null;
  readonly knowledgeBase: string;
}

export interface PreservedBankAccount {
  readonly account: BankAccountRow;
  readonly credentials: readonly CredentialRow[];
}

export interface PreservedState {
  readonly tenantIds: readonly string[];
  readonly tenants: ReadonlyMap<string, { name: string; slug: string }>;
  readonly passwordHashes: ReadonlyMap<string, string>;
  readonly users: readonly UserRow[];
  readonly configs: ReadonlyMap<string, PreservedConfig>;
  readonly whatsapp: readonly WhatsappRow[];
  readonly telegram: readonly TelegramRow[];
  readonly bankAccounts: readonly PreservedBankAccount[];
}

export async function capturePreservedState(db: Db): Promise<PreservedState> {
  const tenants = await db.select().from(schema.tenant);
  const users = await db.select().from(schema.appUser);
  const configs = await db.select().from(schema.tenantConfig);
  const accounts = await db.select().from(schema.tenantBankAccount);
  const credentials = await db.select().from(schema.bankCredential);
  return {
    tenantIds: tenants.map((t) => t.id),
    tenants: new Map(
      tenants.map((t) => [t.id, { name: t.name, slug: t.slug }]),
    ),
    passwordHashes: new Map(users.map((u) => [u.email, u.passwordHash])),
    users,
    configs: new Map(
      configs.map((c) => [
        c.tenantId,
        {
          aiProvider: c.aiProvider,
          aiApiKey: c.aiApiKey,
          whatsappPhoneNumberId: c.whatsappPhoneNumberId,
          knowledgeBase: c.knowledgeBase,
        },
      ]),
    ),
    whatsapp: await db.select().from(schema.whatsappChannel),
    telegram: await db.select().from(schema.telegramChannel),
    bankAccounts: accounts.map((account) => ({
      account,
      credentials: credentials.filter((c) => c.bankAccountId === account.id),
    })),
  };
}

/**
 * Id del tenant principal: el pedido por entorno, el que ya existe con su slug, o el único tenant
 * existente (producción lo creó con otro id). Si no, el id por defecto del escenario.
 */
export function resolveMainTenantId(
  preserved: PreservedState,
  scenario: TenantScenario,
  requested: string | null,
): string {
  if (requested) return requested;
  const bySlug = [...preserved.tenants].find(
    ([, t]) => t.slug === scenario.slug,
  );
  if (bySlug) return bySlug[0];
  if (preserved.tenantIds.length === 1) return preserved.tenantIds[0]!;
  return scenario.id;
}

/**
 * Tenants que existen y que el seed NO administra: borrarlos sería perder datos ajenos al seed.
 * Falla cerrado salvo confirmación explícita.
 */
export function foreignTenants(
  preserved: PreservedState,
  managedIds: readonly string[],
): string[] {
  return preserved.tenantIds.filter((id) => !managedIds.includes(id));
}

/** Usuarios reales que el escenario no define: se conservan con su rol, zonas y contraseña. */
export function extraUsersFor(
  preserved: PreservedState,
  tenantId: string,
  seededEmails: ReadonlySet<string>,
): UserRow[] {
  return preserved.users.filter(
    (u) => u.tenantId === tenantId && !seededEmails.has(u.email),
  );
}

/** Otros SUPER_ADMIN reales (además del sembrado). */
export function extraSuperAdmins(preserved: PreservedState): UserRow[] {
  return preserved.users.filter(
    (u) => u.role === 'SUPER_ADMIN' && u.email !== SUPER_ADMIN_EMAIL,
  );
}
