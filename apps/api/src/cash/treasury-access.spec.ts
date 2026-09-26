process.env.JWT_SECRET = 'test-secret-please-change';

import { ForbiddenException } from '@nestjs/common';
import { signToken, TOKEN_TTL } from '../auth/jwt';
import { CashBoxController } from './cash-box.controller';
import { CashController } from './cash.controller';
import { DashboardController } from '../dashboard/dashboard.controller';

// La moneda del tenant sale de la BD; aquí basta con un valor fijo (prueba de frontera, sin BD).
jest.mock('../tenant-config/tenant-currency', () => ({
  resolveTenantCurrency: () => Promise.resolve('COP'),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';

function bearer(role: 'COLLECTOR' | 'COORDINATOR'): string {
  const token = signToken(
    { sub: 'u-1', tenantId: TENANT, role, zonePaths: ['norte'], typ: 'access' },
    TOKEN_TTL.access,
  );
  return `Bearer ${token}`;
}

// Read models de mentira: si la autorización deja pasar, responden algo; nunca tocan la BD.
const ok = () => Promise.resolve({ items: [], total: 0 });
const queries = {
  getCashDashboard: ok,
  listCashTransactions: ok,
  getDailyReport: ok,
  getKpis: ok,
};
const boxes = { list: () => Promise.resolve([]) };

const cashBox = new CashBoxController(
  boxes as never,
  queries as never,
  {} as never,
  {} as never,
);
const cash = new CashController({} as never, queries as never, {} as never);
const dashboard = new DashboardController(queries as never);

// Lecturas de TESORERÍA y cifras de toda la empresa: el cobrador no las ve (hallazgo cerrado).
const treasuryReads: [string, (auth: string) => Promise<unknown>][] = [
  ['GET /cash/dashboard', (auth) => cashBox.dashboard(TENANT, auth)],
  ['GET /cash/boxes', (auth) => cashBox.list(TENANT, auth)],
  ['GET /cash/transactions', (auth) => cashBox.transactions(TENANT, auth, {})],
  ['GET /reports/daily', (auth) => cash.dailyReport(TENANT, auth, {})],
  ['GET /dashboard/kpis', (auth) => dashboard.kpis(TENANT, auth)],
];

describe('Lecturas de tesorería: solo ADMIN/COORDINATOR', () => {
  it.each(treasuryReads)(
    '%s responde 403 al cobrador',
    async (_route, call) => {
      await expect(call(bearer('COLLECTOR'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it.each(treasuryReads)('%s responde al coordinador', async (_route, call) => {
    await expect(call(bearer('COORDINATOR'))).resolves.toBeDefined();
  });
});
