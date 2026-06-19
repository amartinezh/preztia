// setupFiles de los tests de integración: carga el .env de la raíz del monorepo ANTES de
// importar cualquier módulo (unit-of-work lee APP_DATABASE_URL en tiempo de import). Las
// variables ya presentes en el entorno (CI) tienen prioridad: dotenv no las sobrescribe.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });

process.env.JWT_SECRET ||= 'test-secret-please-change';
process.env.CREDIT_CURRENCY ||= 'COP';
// Clave de 32 bytes (base64) para el cifrado de secretos en reposo, si no viene del entorno.
process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString('base64');
