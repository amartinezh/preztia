import { describe, expect, it } from "vitest";
import {
  CLIENT_LANGUAGES,
  DEFAULT_CLIENT_LANGUAGE,
  clientLanguageOrDefault,
  isClientLanguage,
  parseClientLanguage,
} from "./client-language";
import { clientMessagesFor, type ClientMessages } from "./client-messages";
import { DomainError } from "../../shared/money";
import { buildCollectionReminderMessage } from "../../credit/collection/collection-reminder";
import {
  buildAccountBalanceMessage,
  buildAccountMovementsMessage,
} from "../../credit/portfolio/account-inquiry";
import {
  buildChargeInstructionsMessage,
  buildPaymentOptionsMessage,
} from "../../credit/payment/payment-intent";
import { buildCommittedApplicantReply } from "../assistant";
import { parseAcceptance } from "../../credit/plan/plan-reply";

/** Rutas de todas las hojas del catálogo (texto o redactor), p. ej. "charge.choiceReask". */
function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string" || typeof node === "function") return [prefix];
  return Object.entries(node as Record<string, unknown>)
    .flatMap(([key, value]) => leafPaths(value, prefix ? `${prefix}.${key}` : key))
    .sort();
}

/** Redacta todas las hojas con argumentos de muestra para comparar el texto final entre idiomas. */
function renderAll(m: ClientMessages): string[] {
  return [
    m.assistant.offTopic,
    m.assistant.unavailable,
    m.assistant.committedApplicant("3001234567"),
    m.application.intro,
    m.application.amountQuestion,
    m.application.resume,
    m.application.alreadySubmitted,
    m.application.restart,
    m.application.amountOk,
    m.application.amountReask,
    m.application.completed,
    m.application.alreadyComplete,
    m.application.fileReceived,
    m.application.fileReceivedForManualReview,
    m.application.offerManualReview,
    m.application.locationReceived,
    m.application.remainingFiles(1),
    m.application.remainingFiles(2),
    m.application.mismatchRetry({ detected: null, prompt: "", attemptsLeft: 2 }),
    m.receipt.noActiveCredit,
    m.receipt.notAReceipt,
    m.receipt.inVerification,
    m.receipt.unreadable,
    m.receipt.underReview,
    m.receipt.settled({ paid: "R$ 10,00", overpayment: "R$ 1,00" }),
    m.receipt.allocated({ paid: "R$ 10,00", installments: 2, remaining: "R$ 5,00" }),
    m.receipt.bankConfirmedSettled,
    m.receipt.bankConfirmed("R$ 5,00"),
    m.receipt.confirmedSettled,
    m.receipt.confirmed,
    m.charge.choiceReask,
    m.charge.noActiveCredit,
    m.charge.creationFailed,
    m.account.noPayments,
    m.account.allUpToDate,
    m.plan.acceptanceReask,
    m.plan.accepted,
    m.plan.declined,
    m.plan.expired,
    m.credit.registered(null),
    m.telegram.requestContact,
    m.telegram.identified,
    m.telegram.rejection.NOT_OWN_CONTACT,
    m.telegram.rejection.INVALID_PHONE,
  ];
}

const STATEMENT = {
  firstName: "Ana",
  currency: "BRL",
  credits: [
    {
      startDate: "2026-09-01",
      totalDueMinor: 120000,
      totalPaidMinor: 20000,
      outstandingMinor: 100000,
      dueTodayMinor: 30000,
      overdueMinor: 10000,
      movements: [{ date: "2026-09-02", amountMinor: 20000 }],
    },
  ],
};

describe("idioma de atención al cliente", () => {
  it("el idioma por defecto es español y está soportado", () => {
    expect(DEFAULT_CLIENT_LANGUAGE).toBe("es");
    expect(CLIENT_LANGUAGES).toEqual(["es", "pt-BR"]);
    expect(isClientLanguage("pt-BR")).toBe(true);
    expect(isClientLanguage("en")).toBe(false);
  });

  it("falla rápido al configurar un idioma no soportado", () => {
    expect(parseClientLanguage("pt-BR")).toBe("pt-BR");
    expect(() => parseClientLanguage("fr")).toThrow(DomainError);
  });

  it("la lectura desde persistencia cae al idioma por defecto ante valores desconocidos", () => {
    expect(clientLanguageOrDefault("pt-BR")).toBe("pt-BR");
    expect(clientLanguageOrDefault(null)).toBe("es");
    expect(clientLanguageOrDefault("klingon")).toBe("es");
  });
});

describe("catálogo de mensajes al cliente", () => {
  it("todos los idiomas definen exactamente las mismas claves que el español", () => {
    const reference = leafPaths(clientMessagesFor("es"));
    for (const language of CLIENT_LANGUAGES) {
      expect(leafPaths(clientMessagesFor(language))).toEqual(reference);
    }
  });

  it("ningún texto de pt-BR queda igual al español (sin fugas de idioma)", () => {
    const es = renderAll(clientMessagesFor("es"));
    const pt = renderAll(clientMessagesFor("pt-BR"));
    pt.forEach((text, i) => {
      expect(text.trim()).not.toBe("");
      expect(text).not.toBe(es[i]);
    });
  });

  it("sin idioma explícito usa el español (compatibilidad de los tenants previos)", () => {
    expect(clientMessagesFor()).toBe(clientMessagesFor("es"));
  });

  it("concuerda singular y plural en portugués", () => {
    const m = clientMessagesFor("pt-BR").application;
    expect(m.remainingFiles(1)).toContain("mais 1 foto");
    expect(m.remainingFiles(3)).toContain("mais 3 fotos");
    expect(m.mismatchRetry({ detected: null, prompt: "P.", attemptsLeft: 1 })).toContain(
      "Resta 1 tentativa antes",
    );
    expect(m.mismatchRetry({ detected: "RG", prompt: "P.", attemptsLeft: 2 })).toContain(
      "(parece ser: RG)",
    );
  });

  it("en portugués no cita los motivos internos (en español) del antifraude", () => {
    const text = clientMessagesFor("pt-BR").application.structuralReject(
      ["formato no permitido (text/plain)"],
      "Envie seu RG.",
    );
    expect(text).not.toContain("formato no permitido");
    expect(text).toContain("Envie seu RG.");
  });
});

describe("redactores de dominio en el idioma del tenant", () => {
  it("el recordatorio de cobro sale en portugués con el monto y la chave PIX", () => {
    const text = buildCollectionReminderMessage(
      { firstName: "Ana", dueMinor: 123456, currency: "BRL", pixKey: "chave@pix" },
      "pt-BR",
    );
    expect(text).toContain("Olá, Ana!");
    expect(text).toContain("sua parcela de hoje é de R$ 1.234,56");
    expect(text).toContain("chave@pix");
  });

  it("el recordatorio mantiene su invariante en cualquier idioma (nada que cobrar → error)", () => {
    expect(() =>
      buildCollectionReminderMessage(
        { firstName: "Ana", dueMinor: 0, currency: "BRL", pixKey: "k" },
        "pt-BR",
      ),
    ).toThrow(DomainError);
  });

  it("el saldo y los movimientos salen en portugués con los mismos montos", () => {
    const balance = buildAccountBalanceMessage(STATEMENT, "pt-BR");
    expect(balance).toContain("Valor total do crédito: R$ 1.200,00");
    expect(balance).toContain("Falta pagar: R$ 1.000,00");
    expect(balance).toContain("Em atraso: R$ 100,00");
    const movements = buildAccountMovementsMessage(STATEMENT, "pt-BR");
    expect(movements).toContain("2026-09-02 — R$ 200,00");
    expect(movements).toContain("pagamentos do seu crédito");
  });

  it("el menú de cobro omite la opción 2 sin atrasos también en portugués", () => {
    const text = buildPaymentOptionsMessage(
      { firstName: "Ana", installmentMinor: 5000, overdueMinor: 5000, currency: "BRL" },
      "pt-BR",
    );
    expect(text).toContain("Sua parcela de hoje — R$ 50,00");
    expect(text).not.toContain("2️⃣");
  });

  it("las instrucciones PIX incluyen el código y el vencimiento en portugués", () => {
    const text = buildChargeInstructionsMessage(
      { amountMinor: 5000, currency: "BRL", copyPasteCode: "000201PIX", expiresInMinutes: 15 },
      "pt-BR",
    );
    expect(text).toContain("000201PIX");
    expect(text).toContain("O código vence em 15 minutos");
  });

  it("el redactor de solicitante comprometido respeta el idioma y el teléfono de la zona", () => {
    expect(buildCommittedApplicantReply("3001234567", "pt-BR")).toContain("pelo 3001234567");
    expect(buildCommittedApplicantReply(null)).toContain("Tu crédito ya está registrado");
  });
});

describe("respuesta a la oferta en portugués", () => {
  it("interpreta SIM / NÃO y prioriza el rechazo", () => {
    expect(parseAcceptance("Sim")).toBe("ACCEPT");
    expect(parseAcceptance("aceito")).toBe("ACCEPT");
    expect(parseAcceptance("NÃO")).toBe("DECLINE");
    expect(parseAcceptance("não aceito")).toBe("DECLINE");
  });
});
