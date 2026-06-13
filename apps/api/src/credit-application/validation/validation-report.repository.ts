import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import {
  type DocumentValidationReport,
  type ValidationReportRepository,
} from '@preztiaos/application';
import { withTenantTxFor } from '../../tenancy/unit-of-work';

const VALIDATION_COMPLETED_EVENT = 'ANTIFRAUD_VALIDATION_COMPLETED';

/**
 * Adaptador del puerto ValidationReportRepository: persiste el reporte del
 * pipeline (append-only, bajo RLS) y deja el evento en la bitácora de la
 * solicitud, ambos en la MISMA transacción (auditabilidad atómica).
 */
@Injectable()
export class DrizzleValidationReportRepository implements ValidationReportRepository {
  save(report: DocumentValidationReport): Promise<void> {
    return withTenantTxFor(report.tenantId, async (tx) => {
      await tx.insert(schema.documentValidation).values({
        tenantId: report.tenantId,
        applicationId: report.applicationId,
        status: report.status,
        score: report.score,
        alerts: report.alerts.map((alert) => ({
          documento: alert.documento,
          campo: alert.campo,
          severidad: alert.severidad,
          detalle: alert.detalle,
        })),
        consultedSources: [...report.consultedSources],
      });
      // Bitácora de la solicitud: sin PII, solo veredicto agregado y conteo.
      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: report.tenantId,
        applicationId: report.applicationId,
        type: VALIDATION_COMPLETED_EVENT,
        payload: {
          status: report.status,
          score: report.score,
          alertCount: report.alerts.length,
          consultedSources: [...report.consultedSources],
        },
      });
    });
  }
}
