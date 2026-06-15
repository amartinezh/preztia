import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { ChangeRequestDrizzleRepository } from './change-request.repository';
import { OperationsQueryRepository } from './operations-query.repository';
import { BorrowerDrizzleRepository } from '../borrowers/borrowers.repository';

/**
 * Módulo de OPERACIONES: solicitudes de modificación de cliente (maker-checker) y lista de
 * cobros/rutas. Reusa `BorrowerDrizzleRepository` para aplicar los cambios al aprobar.
 */
@Module({
  controllers: [OperationsController],
  providers: [
    ChangeRequestDrizzleRepository,
    OperationsQueryRepository,
    BorrowerDrizzleRepository,
  ],
})
export class OperationsModule {}
