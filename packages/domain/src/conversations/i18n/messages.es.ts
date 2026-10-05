import type { ClientMessages } from "./client-messages";

// Diccionario ESPAÑOL: los textos históricos del chat, sin cambios de redacción.

const SHARE_CONTACT_BUTTON = "📱 Compartir mi número";

export const ES_CLIENT_MESSAGES: ClientMessages = {
  assistant: {
    offTopic:
      "Con gusto te atiendo, pero este chat es exclusivamente para temas relacionados con nuestro servicio de apoyo crediticio (información del crédito y solicitudes). ¿Tienes alguna duda sobre el crédito o deseas iniciar una solicitud?",
    unavailable:
      "En este momento tenemos alta demanda y no puedo procesar tu mensaje. Por favor, inténtalo de nuevo en unos minutos. 🙏",
    committedApplicant: (supportPhone) => {
      const support = supportPhone
        ? `Si tienes alguna duda o inconveniente, escríbenos por este medio o comunícate con servicio al cliente al ${supportPhone}.`
        : "Si tienes alguna duda o inconveniente, escríbenos por este medio o comunícate con servicio al cliente.";
      return `Tu crédito ya está registrado y en proceso. 🙌 ${support}`;
    },
  },

  application: {
    intro: "¡Perfecto! Iniciemos tu solicitud de crédito.",
    amountQuestion: "¿Cuánto dinero deseas solicitar?",
    resume: "Ya tienes una solicitud en curso. Continuemos donde quedamos.",
    alreadySubmitted:
      "Ya recibimos todos tus documentos y tu solicitud está *en revisión*; te avisaremos el resultado. " +
      "Si necesitas enviarlos de nuevo, escribe: *quiero ingresar nuevamente los documentos*.",
    restart:
      "¡Listo! Reiniciamos tu solicitud. Te pediré nuevamente todos los documentos, uno a la vez.",
    amountOk:
      "¡Gracias! Anotamos tu monto. Ahora te pediré los documentos requeridos, uno a la vez.",
    amountReask:
      "No entendí el monto. Por favor responde solo con el número que deseas solicitar (ej. 300000).",
    completed:
      "¡Gracias! Recibimos todos tus documentos. Por último, comparte tu *ubicación* actual con el " +
      "clip 📎 → Ubicación (idealmente desde tu negocio o domicilio) para completar tu solicitud.",
    alreadyComplete:
      "Ya tenemos todos tus documentos y tu solicitud está *en revisión*; no necesitas enviar nada más. " +
      "Te avisaremos el resultado.",
    fileReceived: "✅ Archivo recibido.",
    fileReceivedForManualReview:
      "📝 Archivo recibido y marcado para *revisión manual* de un analista.",
    offerManualReview:
      "Hemos intentado validar tus fotos varias veces y al parecer no son las correctas. " +
      "Si estás seguro de que son las fotos solicitadas, *envíalas una vez más* y las " +
      "remitiremos a un analista de cartera para revisión manual.",
    locationReceived:
      "📍 ¡Gracias! Recibimos tu ubicación. Con esto completamos tu solicitud; un asesor la revisará y nos comunicaremos contigo en el menor tiempo posible.",
    documentFallback: (documentType) => `Envíame el documento: ${documentType}.`,
    remainingFiles: (missing) =>
      missing === 1
        ? "Falta *1 foto más* de este mismo documento (el otro lado). Envíala, por favor."
        : `Faltan *${missing} fotos más* de este mismo documento. Envíalas, por favor.`,
    structuralReject: (reasons, prompt) => {
      const why = reasons.length ? ` (${reasons.join("; ")})` : "";
      return `No pudimos validar el documento${why}. Por favor, reenvíalo. ${prompt}`;
    },
    mismatchRetry: ({ detected, prompt, attemptsLeft }) => {
      const detectedNote = detected ? ` (parece ser: ${detected})` : "";
      return (
        `El documento que enviaste al parecer no es el correcto${detectedNote}. ${prompt} ` +
        `Por favor, envíalo de nuevo. Te ${attemptsLeft === 1 ? "queda" : "quedan"} ` +
        `${attemptsLeft} intento${attemptsLeft === 1 ? "" : "s"} antes de pasarlo a revisión manual.`
      );
    },
    pendingReminder: (documentTitle) =>
      `📋 Recuerda que aún tienes una solicitud en curso. Para continuar: ${documentTitle}`,
  },

  receipt: {
    noActiveCredit:
      "No encontramos un crédito activo asociado a este número. Guardamos tu comprobante y un asesor lo revisará.",
    notAReceipt:
      "El archivo que enviaste no parece un comprobante de pago. Si realizaste un pago, envíame la foto o el PDF del comprobante PIX.",
    inVerification:
      "Recibimos tu comprobante y está *en verificación* con el banco. Te confirmaremos el abono apenas se valide.",
    unreadable:
      "No pudimos leer el monto del comprobante. Por favor envía una foto o PDF más legible del comprobante PIX.",
    underReview: "No pudimos validar este comprobante. Un analista lo revisará y te contactaremos.",
    settled: ({ paid, overpayment }) => {
      const credit = overpayment ? ` Quedó un saldo a tu favor de ${overpayment}.` : "";
      return `✅ Recibimos tu pago de ${paid}. 🎉 ¡Tu crédito quedó *saldado*!${credit}`;
    },
    allocated: ({ paid, installments, remaining }) =>
      `✅ Recibimos tu pago de ${paid} y abonamos ${installments} cuota${installments === 1 ? "" : "s"}. ` +
      `Saldo pendiente: ${remaining}.`,
    bankConfirmedSettled: "✅ Tu pago fue confirmado por el banco. 🎉 ¡Tu crédito quedó *saldado*!",
    bankConfirmed: (remaining) =>
      `✅ Tu pago fue confirmado por el banco. Saldo pendiente: ${remaining}.`,
    confirmedSettled: "✅ Tu pago fue confirmado. 🎉 ¡Tu crédito quedó *saldado*!",
    confirmed: "✅ Tu pago fue confirmado.",
  },

  charge: {
    paymentOptions: ({ firstName, installment, overdue }) =>
      [
        `¡Hola ${firstName}! 👋 Con gusto tomamos tu pago.`,
        "",
        "¿Cuánto deseas pagar hoy? Responde con el número o escribe otro valor:",
        `*1️⃣* Tu cuota de hoy — ${installment}`,
        ...(overdue ? [`*2️⃣* Todo lo pendiente — ${overdue}`] : []),
        "",
        "También puedes responder con *otro monto* (por ejemplo: 150) y generamos tu cobro por ese valor. 💚",
      ].join("\n"),
    chargeInstructions: ({ amount, copyPasteCode, expiresInMinutes }) =>
      [
        `Perfecto ✅ Generamos tu cobro por *${amount}*.`,
        "",
        "Copia el siguiente código *PIX* y págalo desde tu banco (Pix → Pix Copia e Cola):",
        "",
        copyPasteCode,
        "",
        `El código vence en ${expiresInMinutes} minutos. Apenas confirmemos el pago, te avisamos por aquí. 🙏`,
      ].join("\n"),
    choiceReask:
      "No entendí el monto 🤔. Responde *1* para tu cuota de hoy, *2* para todo lo pendiente, o escribe un valor (por ejemplo: 150).",
    noActiveCredit:
      "No encontramos un crédito activo asociado a este número. Si crees que es un error, un asesor te ayudará. 🙏",
    creationFailed:
      "Tuvimos un problema al generar tu cobro en este momento 😞. Por favor inténtalo de nuevo en unos minutos.",
  },

  account: {
    balanceIntroSingle: (firstName) => `¡Hola ${firstName}! 👋 Este es el estado de tu crédito:`,
    balanceIntroMulti: (firstName, credits) =>
      `¡Hola ${firstName}! 👋 Tienes ${credits} créditos activos:`,
    movementsIntroSingle: (firstName) => `¡Hola ${firstName}! 👋 Estos son los pagos de tu crédito:`,
    movementsIntroMulti: (firstName) =>
      `¡Hola ${firstName}! 👋 Estos son los pagos de tus créditos activos:`,
    totalDue: (amount) => `💳 Valor total del crédito: ${amount}`,
    paid: (amount) => `✅ Has abonado: ${amount}`,
    outstanding: (amount) => `📌 Te falta por pagar: ${amount}`,
    outstandingShort: (amount) => `📌 Te falta: ${amount}`,
    dueToday: (amount) => `📅 Debes a la fecha: ${amount}`,
    totalOutstanding: (amount) => `📊 En total te falta por pagar: ${amount}`,
    totalOverdue: (amount) => `⚠️ En mora (total): ${amount}`,
    allUpToDate: "🟢 ¡Estás al día en todos tus créditos! 🎉",
    overdueDetail: (amount) => `⚠️ En mora (atrasado): ${amount}`,
    upToDateDetail: "🟢 En mora: ¡estás al día! 🎉",
    overdueCompact: (amount) => `⚠️ En mora: ${amount}`,
    upToDateCompact: "🟢 Al día",
    noPayments: "Aún no registramos pagos.",
    creditLabel: (total, startDate) => `Crédito de ${total} · desde ${startDate}`,
    noActiveCredit:
      "No encontramos un crédito activo asociado a este número. Si crees que es un error, un asesor te ayudará. 🙏",
  },

  reminder: {
    collectionReminder: ({ firstName, amount, pixKey }) =>
      [
        `¡Hola ${firstName}! 👋`,
        "",
        `Te recordamos que tu cuota de hoy es de ${amount}.`,
        `Por favor realiza tu pago hoy mediante una transferencia *PIX* a la llave:`,
        pixKey,
        "",
        "Cuando completes el pago, envíanos la *foto del comprobante* respondiendo " +
          "directamente a este mismo chat. 🙏",
        "",
        "¡Gracias por tu puntualidad! 😊",
      ].join("\n"),
  },

  plan: {
    frequency: { DAILY: "diario", WEEKLY: "semanal", BIWEEKLY: "quincenal", MONTHLY: "mensual" },
    planLine: ({ name, installments, frequency, interestPct }) =>
      `${name} — ${installments} cuotas ${frequency} · ${interestPct}%`,
    menu: (planLines) =>
      ["Tenés estos planes disponibles. Respondé con el número del que prefieras:", ...planLines].join("\n"),
    offer: ({ principal, planName, scheduleRows, total, installments, frequency }) =>
      [
        `¡Buenas noticias! 🎉 Luego de estudiar tu solicitud, tenemos un crédito de ${principal} para ofrecerte.`,
        `Tu plan de pago (${planName}) quedaría así:`,
        ...scheduleRows,
        `Total a pagar: ${total} en ${installments} cuotas (${frequency}).`,
        "¿Aceptás tomar el crédito? Respondé SÍ o NO.",
      ].join("\n"),
    selectionReask: (planLines) =>
      ["No entendí tu elección. Respondé con el número del plan:", ...planLines].join("\n"),
    acceptanceReask: "¿Aceptás tomar el crédito con ese plan? Respondé SÍ o NO.",
    accepted: "¡Listo! Registramos tu aceptación. Un asesor confirmará el desembolso.",
    declined: "Entendido, no avanzamos con el crédito. Quedamos atentos si cambiás de opinión.",
    expired: "Tu oferta venció. Un asesor te contactará para retomar el proceso.",
  },

  credit: {
    registered: (supportPhone) =>
      [
        "¡Tu crédito fue registrado! ✅ Lo desembolsaremos a la brevedad.",
        supportPhone
          ? `Si tienes algún inconveniente, no dudes en escribirnos o comunicarte con servicio al cliente al ${supportPhone}.`
          : "Si tienes algún inconveniente, no dudes en escribirnos o comunicarte con servicio al cliente.",
      ].join("\n"),
  },

  telegram: {
    shareContactButton: SHARE_CONTACT_BUTTON,
    shareContactPlaceholder: "Toca el botón para compartir tu número",
    requestContact:
      "¡Hola! 👋 Para atenderte y proteger tu información necesitamos verificar tu número. " +
      `Toca el botón «${SHARE_CONTACT_BUTTON}» que aparece abajo.`,
    identified:
      "¡Listo! ✅ Ya verificamos tu número. Escríbenos en qué te podemos ayudar.\n\n" +
      "📎 Consejo: cuando te pidamos documentos o comprobantes, envíalos como *archivo* " +
      "(clip → Archivo) para que lleguen nítidos.",
    rejection: {
      NOT_OWN_CONTACT:
        "Solo podemos verificar TU propio número. Por favor usa el botón " +
        `«${SHARE_CONTACT_BUTTON}» en lugar de enviar un contacto guardado.`,
      INVALID_PHONE:
        "No pudimos leer tu número. Por favor inténtalo de nuevo con el botón " +
        `«${SHARE_CONTACT_BUTTON}».`,
    },
  },
};
