import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { ZonesController } from './zones.controller';
import { CollectorsController } from './collectors.controller';
import { UserDrizzleRepository } from './users.repository';
import { UsersQueryRepository } from './users-query.repository';
import { ZoneDrizzleRepository } from './zones.repository';
import { ZonesQueryRepository } from './zones-query.repository';
import { CollectorClientRepository } from './collector-client.repository';
import { ClientsQueryRepository } from './clients-query.repository';
import { ScryptPasswordHasher } from '../auth/password-hasher';

/**
 * Módulo del PLANO DE DATOS del IAM: usuarios, zonas y asignación cobrador→clientes del
 * tenant. Todo bajo el rol `app` + RLS y `JwtGuard` (tenant del header = sesión). El plano de
 * control (tenants) vive en `PlatformModule`.
 */
@Module({
  controllers: [UsersController, ZonesController, CollectorsController],
  providers: [
    UserDrizzleRepository,
    UsersQueryRepository,
    ZoneDrizzleRepository,
    ZonesQueryRepository,
    CollectorClientRepository,
    ClientsQueryRepository,
    ScryptPasswordHasher,
  ],
})
export class IamModule {}
