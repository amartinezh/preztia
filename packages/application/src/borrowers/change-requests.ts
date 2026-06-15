import { randomUUID } from "node:crypto";
import { NotFoundError, decideChangeRequest } from "@preztiaos/domain";
import type {
  BorrowerPatch,
  BorrowerStore,
  ChangeRequestRecord,
  ChangeRequestStore,
} from "./ports";

// Casos de uso de SOLICITUD DE MODIFICACIÓN DE CLIENTE (maker-checker). El cobrador propone;
// el ADMIN/COORDINATOR aprueba (se aplican los cambios al cliente) o rechaza.

export interface RequestBorrowerChangeCommand {
  tenantId: string;
  borrowerId: string;
  requestedBy: string;
  changes: BorrowerPatch;
}

export class RequestBorrowerChangeHandler {
  constructor(
    private readonly requests: ChangeRequestStore,
    private readonly borrowers: BorrowerStore,
  ) {}

  async execute(cmd: RequestBorrowerChangeCommand): Promise<{ id: string }> {
    // El cliente debe existir en el tenant antes de proponer cambios.
    const borrower = await this.borrowers.findById({
      tenantId: cmd.tenantId,
      borrowerId: cmd.borrowerId,
    });
    if (!borrower) throw new NotFoundError("El cliente no existe");
    const id = randomUUID();
    await this.requests.create({
      id,
      tenantId: cmd.tenantId,
      borrowerId: cmd.borrowerId,
      requestedBy: cmd.requestedBy,
      changes: cmd.changes,
    });
    return { id };
  }
}

export interface ReviewBorrowerChangeCommand {
  tenantId: string;
  requestId: string;
  reviewerId: string;
  approve: boolean;
}

export class ReviewBorrowerChangeHandler {
  constructor(
    private readonly requests: ChangeRequestStore,
    private readonly borrowers: BorrowerStore,
  ) {}

  async execute(cmd: ReviewBorrowerChangeCommand): Promise<ChangeRequestRecord> {
    const current = await this.requests.findById({
      tenantId: cmd.tenantId,
      requestId: cmd.requestId,
    });
    if (!current) throw new NotFoundError("La solicitud no existe");
    // El dominio impone la transición única (solo PENDING se revisa).
    const status = decideChangeRequest(current.status, cmd.approve);

    // Al aprobar, los cambios propuestos se aplican al cliente (puede lanzar 404/409).
    if (status === "APPROVED") {
      const updated = await this.borrowers.update({
        tenantId: cmd.tenantId,
        borrowerId: current.borrowerId,
        patch: current.changes,
      });
      if (!updated) throw new NotFoundError("El cliente no existe");
    }

    const reviewed = await this.requests.updateReview({
      tenantId: cmd.tenantId,
      requestId: cmd.requestId,
      status,
      reviewedBy: cmd.reviewerId,
      reviewedAt: new Date(),
    });
    if (!reviewed) throw new NotFoundError("La solicitud no existe");
    return reviewed;
  }
}
