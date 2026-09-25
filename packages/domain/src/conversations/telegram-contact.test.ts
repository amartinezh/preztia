import { describe, expect, it } from "vitest";
import {
  TelegramContactRejectedError,
  telegramInboundMessageId,
  verifiedPhoneOf,
  type TelegramContactRejection,
} from "./telegram-contact";

const SENDER = "123456789";

function rejectionOf(fn: () => unknown): TelegramContactRejection {
  try {
    fn();
  } catch (error) {
    if (error instanceof TelegramContactRejectedError) return error.reason;
    throw error;
  }
  throw new Error("se esperaba un rechazo");
}

describe("verifiedPhoneOf", () => {
  it("acepta el contacto propio y normaliza el número a E.164 sin '+'", () => {
    expect(
      verifiedPhoneOf({
        senderUserId: SENDER,
        contactUserId: SENDER,
        phoneNumber: "+55 (61) 99999-8888",
      }),
    ).toBe("5561999998888");
  });

  it("acepta el número que Telegram ya entrega sin '+'", () => {
    expect(
      verifiedPhoneOf({ senderUserId: SENDER, contactUserId: SENDER, phoneNumber: "573001234567" }),
    ).toBe("573001234567");
  });

  it("rechaza el contacto de otra cuenta (suplantación)", () => {
    expect(
      rejectionOf(() =>
        verifiedPhoneOf({
          senderUserId: SENDER,
          contactUserId: "987654321",
          phoneNumber: "+5561999998888",
        }),
      ),
    ).toBe("NOT_OWN_CONTACT");
  });

  it("rechaza un contacto que no es cuenta de Telegram (sin user_id atribuible)", () => {
    expect(
      rejectionOf(() =>
        verifiedPhoneOf({ senderUserId: SENDER, contactUserId: null, phoneNumber: "+5561999998888" }),
      ),
    ).toBe("NOT_OWN_CONTACT");
  });

  it.each(["", "+", "1234567", "1234567890123456", "+55 61 9999x8888"])(
    "rechaza un número sin forma de teléfono (%j)",
    (phoneNumber) => {
      expect(
        rejectionOf(() => verifiedPhoneOf({ senderUserId: SENDER, contactUserId: SENDER, phoneNumber })),
      ).toBe("INVALID_PHONE");
    },
  );

  it("expone un código estable por motivo para los clientes", () => {
    expect(new TelegramContactRejectedError("NOT_OWN_CONTACT").code).toBe(
      "TELEGRAM_CONTACT_NOT_OWN_CONTACT",
    );
  });
});

describe("telegramInboundMessageId", () => {
  it("califica el message_id con canal y chat (solo es único dentro de un chat)", () => {
    expect(telegramInboundMessageId("tg:7012345678", "555", 42)).toBe("tg:7012345678:555:42");
    expect(telegramInboundMessageId("tg:7012345678", "556", 42)).not.toBe(
      telegramInboundMessageId("tg:7012345678", "555", 42),
    );
  });
});
