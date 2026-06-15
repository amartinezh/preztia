import { Module } from '@nestjs/common';
import { BorrowersController } from './borrowers.controller';
import { BorrowerListsController } from './borrower-lists.controller';
import {
  BorrowerDrizzleRepository,
  BorrowerNoteDrizzleRepository,
} from './borrowers.repository';
import { BorrowersQueryRepository } from './borrowers-query.repository';
import { BorrowerListDrizzleRepository } from './borrower-list.repository';
import { BorrowerListsQueryRepository } from './borrower-lists-query.repository';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';

/**
 * Módulo del PLANO DE DATOS del registro de CLIENTES (deudores): CRUD, cupo, bloqueo de
 * créditos, color, notas y listas personalizadas. Todo bajo el rol `app` + RLS y `JwtGuard`.
 * Importa TenantConfigModule para aplicar el cupo por defecto al crear clientes.
 */
@Module({
  imports: [TenantConfigModule],
  controllers: [BorrowersController, BorrowerListsController],
  providers: [
    BorrowerDrizzleRepository,
    BorrowerNoteDrizzleRepository,
    BorrowersQueryRepository,
    BorrowerListDrizzleRepository,
    BorrowerListsQueryRepository,
  ],
})
export class BorrowersModule {}
