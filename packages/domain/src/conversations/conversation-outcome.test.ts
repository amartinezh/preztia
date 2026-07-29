import { describe, expect, it } from "vitest";
import {
  classifyConversationOutcome,
  isProtectedFromDeletion,
  type ConversationApplicationStatus,
  type ConversationOutcome,
} from "./conversation-outcome";

const ALL_STATUSES: readonly (ConversationApplicationStatus | null)[] = [
  null,
  "AWAITING_DOCUMENTS",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
];

describe("classifyConversationOutcome", () => {
  it("clasifica como consulta a quien nunca abrió una solicitud", () => {
    expect(
      classifyConversationOutcome({ applicationStatus: null, failureCount: 0 }),
    ).toBe<ConversationOutcome>("ONLY_INQUIRY");
  });

  it("clasifica como incompleta la solicitud que se quedó esperando documentos", () => {
    expect(
      classifyConversationOutcome({
        applicationStatus: "AWAITING_DOCUMENTS",
        failureCount: 0,
      }),
    ).toBe<ConversationOutcome>("INCOMPLETE");
  });

  it("distingue el abandono del fallo técnico en una solicitud a medias", () => {
    expect(
      classifyConversationOutcome({
        applicationStatus: "AWAITING_DOCUMENTS",
        failureCount: 1,
      }),
    ).toBe<ConversationOutcome>("TECHNICAL_FAILURE");
  });

  it("marca como fallo técnico a quien ni siquiera pudo abrir la solicitud", () => {
    expect(
      classifyConversationOutcome({ applicationStatus: null, failureCount: 3 }),
    ).toBe<ConversationOutcome>("TECHNICAL_FAILURE");
  });

  it("separa el expediente completo sin decisión de los ya decididos", () => {
    expect(
      classifyConversationOutcome({
        applicationStatus: "IN_REVIEW",
        failureCount: 0,
      }),
    ).toBe<ConversationOutcome>("PENDING_APPROVAL");
    expect(
      classifyConversationOutcome({
        applicationStatus: "APPROVED",
        failureCount: 0,
      }),
    ).toBe<ConversationOutcome>("APPROVED");
    expect(
      classifyConversationOutcome({
        applicationStatus: "REJECTED",
        failureCount: 0,
      }),
    ).toBe<ConversationOutcome>("REJECTED");
  });

  it("ignora el fallo intermedio cuando la solicitud ya superó el trámite conversacional", () => {
    // Invariante de precedencia: un fallo que el cliente ya superó no reescribe el desenlace.
    for (const status of ["IN_REVIEW", "APPROVED", "REJECTED"] as const) {
      expect(
        classifyConversationOutcome({
          applicationStatus: status,
          failureCount: 9,
        }),
      ).toBe(
        classifyConversationOutcome({
          applicationStatus: status,
          failureCount: 0,
        }),
      );
    }
  });

  it("siempre devuelve exactamente un desenlace (clasificación total)", () => {
    // Invariante: la suma del desglose por desenlace debe cuadrar con el total, lo que exige
    // que TODA combinación de entradas caiga en una y solo una categoría.
    for (const status of ALL_STATUSES) {
      for (const failureCount of [0, 1, 25]) {
        const outcome = classifyConversationOutcome({
          applicationStatus: status,
          failureCount,
        });
        expect(outcome).toBeTypeOf("string");
      }
    }
  });
});

describe("isProtectedFromDeletion", () => {
  it("protege solo la conversación que respalda un crédito aprobado", () => {
    for (const status of ALL_STATUSES) {
      expect(isProtectedFromDeletion(status)).toBe(status === "APPROVED");
    }
  });
});
