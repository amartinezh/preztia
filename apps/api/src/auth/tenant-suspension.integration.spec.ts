import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ForbiddenError } from '@preztiaos/domain';
import { AuthController } from './auth.controller';
import { JwtGuard } from './jwt.guard';
import { hashPassword } from './password';
import { TenantDrizzleRepository } from '../platform/tenants.repository';
import { owner, closeOwner, hasDb } from '../../test/db-helpers';

// Empresa SUSPENDIDA contra Postgres real: sus usuarios no inician sesión, no renuevan la sesión y
// las sesiones vigentes dejan de pasar el guard del plano de datos. Reactivarla devuelve el acceso.
const describeDb = hasDb() ? describe : describe.skip;

const auth = new AuthController();
const guard = new JwtGuard();
const tenants = new TenantDrizzleRepository();
const PASSWORD = 'clave-de-prueba-123';

interface Fixture {
  tenant: string;
  userId: string;
  email: string;
}

/** Contexto HTTP mínimo con los headers que lee el guard. */
function httpContext(token: string, tenant: string): ExecutionContext {
  const request = {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenant },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describeDb('Empresa suspendida (integración)', () => {
  const fixtures: Fixture[] = [];

  async function seed(): Promise<Fixture> {
    const db = owner();
    const tenant = randomUUID();
    const userId = randomUUID();
    const email = `admin-${userId}@t.test`;
    await db`INSERT INTO tenant (id, name, slug) VALUES (${tenant}, 'Empresa', ${`empresa-${tenant.slice(0, 8)}`})`;
    await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths)
      VALUES (${userId}, ${tenant}, ${email}, ${await hashPassword(PASSWORD)}, 'ADMIN', ${[]})`;
    const fixture = { tenant, userId, email };
    fixtures.push(fixture);
    return fixture;
  }

  const suspend = (f: Fixture, status: 'ACTIVE' | 'SUSPENDED') =>
    tenants.update({ id: f.tenant, status });

  afterAll(async () => {
    const db = owner();
    for (const f of fixtures) {
      await db`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM tenant WHERE id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('una empresa suspendida no inicia sesión (403 TENANT_SUSPENDED) y al reactivarla sí', async () => {
    const f = await seed();
    await expect(
      auth.login({ email: f.email, password: PASSWORD }),
    ).resolves.toHaveProperty('accessToken');

    await suspend(f, 'SUSPENDED');
    await expect(
      auth.login({ email: f.email, password: PASSWORD }),
    ).rejects.toMatchObject({
      code: 'TENANT_SUSPENDED',
    });

    await suspend(f, 'ACTIVE');
    await expect(
      auth.login({ email: f.email, password: PASSWORD }),
    ).resolves.toHaveProperty('accessToken');
  });

  it('con una contraseña errada no revela que la empresa está suspendida (401)', async () => {
    const f = await seed();
    await suspend(f, 'SUSPENDED');
    await expect(
      auth.login({ email: f.email, password: 'otra-clave-123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('las sesiones vigentes dejan de pasar el guard y no se renuevan', async () => {
    const f = await seed();
    const pair = await auth.login({ email: f.email, password: PASSWORD });
    await expect(
      guard.canActivate(httpContext(pair.accessToken, f.tenant)),
    ).resolves.toBe(true);

    await suspend(f, 'SUSPENDED');

    await expect(
      guard.canActivate(httpContext(pair.accessToken, f.tenant)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      auth.refresh({ refreshToken: pair.refreshToken }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('un usuario desactivado no renueva su sesión', async () => {
    const f = await seed();
    const pair = await auth.login({ email: f.email, password: PASSWORD });
    await owner()`UPDATE app_user SET active = false WHERE id = ${f.userId}`;
    await expect(
      auth.refresh({ refreshToken: pair.refreshToken }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
