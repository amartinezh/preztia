// Guardas de SEGURIDAD del seed. El seed reemplaza todos los datos de la base, así que falla
// cerrado: contra una base que no es local (o con NODE_ENV=production) exige una confirmación
// explícita y una contraseña propia para los usuarios nuevos (nunca la contraseña por defecto).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export const CONFIRM_PHRASE = 'REEMPLAZAR-DATOS';
const MIN_PASSWORD_LENGTH = 12;
/** Contraseña SOLO para bases locales de desarrollo. */
export const LOCAL_DEFAULT_PASSWORD = 'Preztia#2026';

export interface SeedOptions {
  readonly databaseUrl: string;
  /** Contraseña de los usuarios NUEVOS (los existentes conservan la suya). */
  readonly password: string;
  /** Reemplaza también las contraseñas de los usuarios que ya existían. */
  readonly resetPasswords: boolean;
  /** Sube las evidencias (PDF/PNG) a MinIO. */
  readonly uploadFiles: boolean;
  /** Teléfono real de pruebas para un cliente vitrina (recibe mensajes del canal real). */
  readonly showcasePhone: string | null;
  /** Id del tenant principal cuando producción usa otro distinto del sembrado por defecto. */
  readonly mainTenantId: string | null;
  readonly isShared: boolean;
}

export function resolveSeedOptions(env: NodeJS.ProcessEnv): SeedOptions {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurado');
  const isShared =
    env.NODE_ENV === 'production' ||
    !LOCAL_HOSTS.has(new URL(databaseUrl).hostname);

  if (isShared && env.SEED_CONFIRM !== CONFIRM_PHRASE) {
    throw new Error(
      `La base no es local (o NODE_ENV=production). El seed BORRA todos los datos: ` +
        `confirma con SEED_CONFIRM=${CONFIRM_PHRASE}.`,
    );
  }
  const password =
    env.SEED_PASSWORD ?? (isShared ? null : LOCAL_DEFAULT_PASSWORD);
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Define SEED_PASSWORD (≥ ${MIN_PASSWORD_LENGTH} caracteres) para los usuarios nuevos: ` +
        'fuera de local no se usa la contraseña por defecto.',
    );
  }
  return {
    databaseUrl,
    password,
    resetPasswords: env.SEED_RESET_PASSWORDS === 'yes',
    uploadFiles: env.SEED_SKIP_FILES !== 'yes',
    showcasePhone: normalizePhone(env.SEED_TEST_PHONE),
    mainTenantId: env.SEED_TENANT_ID ?? null,
    isShared,
  };
}

function normalizePhone(raw: string | undefined): string | null {
  const digits = raw?.replace(/\D/g, '') ?? '';
  return digits.length >= 10 ? digits : null;
}
