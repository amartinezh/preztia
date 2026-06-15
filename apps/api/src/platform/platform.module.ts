import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantDrizzleRepository } from './tenants.repository';
import { TenantsQueryRepository } from './tenants-query.repository';
import { TenantAdminsQueryRepository } from './tenant-admins-query.repository';
import { PlatformUserRepository } from './platform-user.repository';
import { ScryptPasswordHasher } from '../auth/password-hasher';

/**
 * Módulo del PLANO DE CONTROL (super admin): CRUD de tenants y provisión de admins. Usa la
 * conexión BYPASSRLS detrás del `SuperAdminGuard`; el plano de datos vive en `IamModule`.
 */
@Module({
  controllers: [TenantsController],
  providers: [
    TenantDrizzleRepository,
    TenantsQueryRepository,
    TenantAdminsQueryRepository,
    PlatformUserRepository,
    ScryptPasswordHasher,
  ],
})
export class PlatformModule {}
