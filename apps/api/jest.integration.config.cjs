// Config de los tests de INTEGRACIÓN (golpean Postgres real como rol `app` → RLS real).
// Separada del `pnpm test` unitario: solo corre con `pnpm --filter api test:integration`
// (y en CI con el servicio de Postgres). `forceExit` cierra el pool de postgres-js.
module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/load-env.ts'],
  forceExit: true,
  testTimeout: 20000,
};
