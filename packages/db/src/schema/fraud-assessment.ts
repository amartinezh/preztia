import {
  pgTable,
  uuid,
  integer,
  jsonb,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { payment } from "./payment";

// Fase de la evaluación antifraude registrada.
export const fraudAssessmentPhase = pgEnum("fraud_assessment_phase", [
  "PHASE1_SCREEN", // pre-screen síncrono (señales baratas: E2E/ISPB, recebedor, dedup, IA blanda)
  "PHASE2_SETTLEMENT", // confirmación contra el ground truth (crédito real del settlement_report)
]);

// Bitácora APPEND-ONLY de evaluaciones antifraude por pago: la traza de "qué señal disparó qué".
// Antes el veredicto solo se reflejaba en el pago y en payment_event; aquí queda consultable con
// status/score/reasons estructurados. RLS FORCE; el rol de aplicación inserta y lee, NO edita ni
// borra (historial inmutable, como el libro mayor). Se borra en cascada con el pago.
export const fraudAssessment = pgTable(
  "fraud_assessment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payment.id, { onDelete: "cascade" }),
    phase: fraudAssessmentPhase("phase").notNull(),
    // Veredicto: Fase 1 → approved|suspicious|rejected; Fase 2 → CONFIRMED|UNCONFIRMED.
    status: text("status").notNull(),
    // Puntaje de riesgo [0,100] de la Fase 1; null en Fase 2 (decisión binaria por ground truth).
    score: integer("score"),
    // Motivos legibles del veredicto (señales que dispararon). Sin PII.
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPaymentIdx: index("fraud_assessment_payment_idx").on(t.tenantId, t.paymentId),
  }),
);
