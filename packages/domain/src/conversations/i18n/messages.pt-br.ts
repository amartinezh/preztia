import type { ClientMessages } from "./client-messages";

// Diccionario PORTUGUÉS DE BRASIL. Tratamiento "você", tono cordial y vocabulario local del
// cobro: "parcela" (cuota), "comprovante" (comprobante), "chave PIX", "Pix Copia e Cola".

const SHARE_CONTACT_BUTTON = "📱 Compartilhar meu número";

export const PT_BR_CLIENT_MESSAGES: ClientMessages = {
  assistant: {
    offTopic:
      "Fico feliz em ajudar, mas este chat é exclusivo para assuntos do nosso serviço de crédito (informações sobre o crédito e solicitações). Você tem alguma dúvida sobre o crédito ou deseja iniciar uma solicitação?",
    unavailable:
      "No momento estamos com alta demanda e não consigo processar sua mensagem. Por favor, tente novamente em alguns minutos. 🙏",
    committedApplicant: (supportPhone) => {
      const support = supportPhone
        ? `Se tiver alguma dúvida ou problema, escreva para nós por aqui ou fale com o atendimento ao cliente pelo ${supportPhone}.`
        : "Se tiver alguma dúvida ou problema, escreva para nós por aqui ou fale com o atendimento ao cliente.";
      return `Seu crédito já está registrado e em andamento. 🙌 ${support}`;
    },
  },

  application: {
    intro: "Perfeito! Vamos iniciar sua solicitação de crédito.",
    amountQuestion: "Quanto dinheiro você deseja solicitar?",
    resume: "Você já tem uma solicitação em andamento. Vamos continuar de onde paramos.",
    alreadySubmitted:
      "Já recebemos todos os seus documentos e sua solicitação está *em análise*; avisaremos o resultado. " +
      "Se precisar enviá-los novamente, escreva: *quero enviar os documentos novamente*.",
    restart:
      "Pronto! Reiniciamos sua solicitação. Vou pedir novamente todos os documentos, um de cada vez.",
    amountOk:
      "Obrigado! Anotamos o valor. Agora vou pedir os documentos necessários, um de cada vez.",
    amountReask:
      "Não entendi o valor. Por favor, responda apenas com o número que deseja solicitar (ex.: 3000).",
    completed:
      "Obrigado! Recebemos todos os seus documentos. Por último, compartilhe sua *localização* atual pelo " +
      "clipe 📎 → Localização (de preferência do seu negócio ou da sua casa) para concluir sua solicitação.",
    alreadyComplete:
      "Já temos todos os seus documentos e sua solicitação está *em análise*; você não precisa enviar mais nada. " +
      "Avisaremos o resultado.",
    fileReceived: "✅ Arquivo recebido.",
    fileReceivedForManualReview:
      "📝 Arquivo recebido e marcado para *análise manual* de um analista.",
    offerManualReview:
      "Tentamos validar suas fotos várias vezes e parece que não são as corretas. " +
      "Se você tem certeza de que são as fotos solicitadas, *envie-as mais uma vez* e nós as " +
      "encaminharemos a um analista de carteira para análise manual.",
    locationReceived:
      "📍 Obrigado! Recebemos sua localização. Com isso concluímos sua solicitação; um consultor vai analisá-la e entraremos em contato com você o quanto antes.",
    documentFallback: (documentType) => `Envie o documento: ${documentType}.`,
    remainingFiles: (missing) =>
      missing === 1
        ? "Falta *mais 1 foto* deste mesmo documento (o outro lado). Envie, por favor."
        : `Faltam *mais ${missing} fotos* deste mesmo documento. Envie, por favor.`,
    // Os motivos do antifraude são texto interno em espanhol: aqui se orienta sem citá-los.
    structuralReject: (_reasons, prompt) =>
      "Não conseguimos validar o documento. Envie novamente uma foto nítida (JPG ou PNG) ou um PDF " +
      `legível. ${prompt}`,
    mismatchRetry: ({ detected, prompt, attemptsLeft }) => {
      const detectedNote = detected ? ` (parece ser: ${detected})` : "";
      return (
        `Parece que o documento que você enviou não é o correto${detectedNote}. ${prompt} ` +
        `Por favor, envie novamente. ${attemptsLeft === 1 ? "Resta" : "Restam"} ` +
        `${attemptsLeft} tentativa${attemptsLeft === 1 ? "" : "s"} antes de passar para análise manual.`
      );
    },
    pendingReminder: (documentTitle) =>
      `📋 Lembre-se de que você ainda tem uma solicitação em andamento. Para continuar: ${documentTitle}`,
  },

  receipt: {
    noActiveCredit:
      "Não encontramos um crédito ativo vinculado a este número. Guardamos seu comprovante e um consultor vai analisá-lo.",
    notAReceipt:
      "O arquivo que você enviou não parece um comprovante de pagamento. Se você fez um pagamento, envie a foto ou o PDF do comprovante PIX.",
    inVerification:
      "Recebemos seu comprovante e ele está *em verificação* com o banco. Confirmaremos o abatimento assim que for validado.",
    unreadable:
      "Não conseguimos ler o valor do comprovante. Por favor, envie uma foto ou PDF mais legível do comprovante PIX.",
    underReview:
      "Não conseguimos validar este comprovante. Um analista vai revisá-lo e entraremos em contato.",
    settled: ({ paid, overpayment }) => {
      const credit = overpayment ? ` Ficou um saldo a seu favor de ${overpayment}.` : "";
      return `✅ Recebemos seu pagamento de ${paid}. 🎉 Seu crédito foi *quitado*!${credit}`;
    },
    allocated: ({ paid, installments, remaining }) =>
      `✅ Recebemos seu pagamento de ${paid} e abatemos ${installments} parcela${installments === 1 ? "" : "s"}. ` +
      `Saldo devedor: ${remaining}.`,
    bankConfirmedSettled: "✅ Seu pagamento foi confirmado pelo banco. 🎉 Seu crédito foi *quitado*!",
    bankConfirmed: (remaining) =>
      `✅ Seu pagamento foi confirmado pelo banco. Saldo devedor: ${remaining}.`,
    confirmedSettled: "✅ Seu pagamento foi confirmado. 🎉 Seu crédito foi *quitado*!",
    confirmed: "✅ Seu pagamento foi confirmado.",
  },

  charge: {
    paymentOptions: ({ firstName, installment, overdue }) =>
      [
        `Olá, ${firstName}! 👋 Vamos registrar seu pagamento.`,
        "",
        "Quanto você deseja pagar hoje? Responda com o número ou escreva outro valor:",
        `*1️⃣* Sua parcela de hoje — ${installment}`,
        ...(overdue ? [`*2️⃣* Tudo o que está pendente — ${overdue}`] : []),
        "",
        "Você também pode responder com *outro valor* (por exemplo: 150) e geramos sua cobrança nesse valor. 💚",
      ].join("\n"),
    chargeInstructions: ({ amount, copyPasteCode, expiresInMinutes }) =>
      [
        `Perfeito ✅ Geramos sua cobrança de *${amount}*.`,
        "",
        "Copie o código *PIX* abaixo e pague pelo app do seu banco (Pix → Pix Copia e Cola):",
        "",
        copyPasteCode,
        "",
        `O código vence em ${expiresInMinutes} minutos. Assim que confirmarmos o pagamento, avisamos você por aqui. 🙏`,
      ].join("\n"),
    choiceReask:
      "Não entendi o valor 🤔. Responda *1* para sua parcela de hoje, *2* para tudo o que está pendente, ou escreva um valor (por exemplo: 150).",
    noActiveCredit:
      "Não encontramos um crédito ativo vinculado a este número. Se você acha que é um erro, um consultor vai ajudar. 🙏",
    creationFailed:
      "Tivemos um problema ao gerar sua cobrança neste momento 😞. Por favor, tente novamente em alguns minutos.",
  },

  account: {
    balanceIntroSingle: (firstName) => `Olá, ${firstName}! 👋 Esta é a situação do seu crédito:`,
    balanceIntroMulti: (firstName, credits) =>
      `Olá, ${firstName}! 👋 Você tem ${credits} créditos ativos:`,
    movementsIntroSingle: (firstName) => `Olá, ${firstName}! 👋 Estes são os pagamentos do seu crédito:`,
    movementsIntroMulti: (firstName) =>
      `Olá, ${firstName}! 👋 Estes são os pagamentos dos seus créditos ativos:`,
    totalDue: (amount) => `💳 Valor total do crédito: ${amount}`,
    paid: (amount) => `✅ Você já pagou: ${amount}`,
    outstanding: (amount) => `📌 Falta pagar: ${amount}`,
    outstandingShort: (amount) => `📌 Falta: ${amount}`,
    dueToday: (amount) => `📅 Valor devido até hoje: ${amount}`,
    totalOutstanding: (amount) => `📊 No total, falta pagar: ${amount}`,
    totalOverdue: (amount) => `⚠️ Em atraso (total): ${amount}`,
    allUpToDate: "🟢 Você está em dia com todos os seus créditos! 🎉",
    overdueDetail: (amount) => `⚠️ Em atraso: ${amount}`,
    upToDateDetail: "🟢 Atraso: você está em dia! 🎉",
    overdueCompact: (amount) => `⚠️ Em atraso: ${amount}`,
    upToDateCompact: "🟢 Em dia",
    noPayments: "Ainda não registramos pagamentos.",
    creditLabel: (total, startDate) => `Crédito de ${total} · desde ${startDate}`,
    noActiveCredit:
      "Não encontramos um crédito ativo vinculado a este número. Se você acha que é um erro, um consultor vai ajudar. 🙏",
  },

  reminder: {
    collectionReminder: ({ firstName, amount, pixKey }) =>
      [
        `Olá, ${firstName}! 👋`,
        "",
        `Lembramos que sua parcela de hoje é de ${amount}.`,
        "Por favor, faça seu pagamento hoje por *PIX* para a chave:",
        pixKey,
        "",
        "Assim que concluir o pagamento, envie a *foto do comprovante* respondendo " +
          "diretamente neste mesmo chat. 🙏",
        "",
        "Obrigado pela sua pontualidade! 😊",
      ].join("\n"),
  },

  plan: {
    frequency: { DAILY: "diárias", WEEKLY: "semanais", BIWEEKLY: "quinzenais", MONTHLY: "mensais" },
    planLine: ({ name, installments, frequency, interestPct }) =>
      `${name} — ${installments} parcelas ${frequency} · ${interestPct}%`,
    menu: (planLines) =>
      ["Você tem estes planos disponíveis. Responda com o número do que preferir:", ...planLines].join("\n"),
    offer: ({ principal, planName, scheduleRows, total, installments, frequency }) =>
      [
        `Boas notícias! 🎉 Depois de analisar sua solicitação, temos um crédito de ${principal} para oferecer a você.`,
        `Seu plano de pagamento (${planName}) ficaria assim:`,
        ...scheduleRows,
        `Total a pagar: ${total} em ${installments} parcelas ${frequency}.`,
        "Você aceita o crédito? Responda SIM ou NÃO.",
      ].join("\n"),
    selectionReask: (planLines) =>
      ["Não entendi sua escolha. Responda com o número do plano:", ...planLines].join("\n"),
    acceptanceReask: "Você aceita o crédito com esse plano? Responda SIM ou NÃO.",
    accepted: "Pronto! Registramos sua aceitação. Um consultor vai confirmar o desembolso.",
    declined: "Entendido, não vamos seguir com o crédito. Estamos à disposição se você mudar de ideia.",
    expired: "Sua oferta expirou. Um consultor vai entrar em contato para retomar o processo.",
  },

  credit: {
    registered: (supportPhone) =>
      [
        "Seu crédito foi registrado! ✅ Faremos o desembolso em breve.",
        supportPhone
          ? `Se tiver algum problema, é só escrever para nós ou falar com o atendimento ao cliente pelo ${supportPhone}.`
          : "Se tiver algum problema, é só escrever para nós ou falar com o atendimento ao cliente.",
      ].join("\n"),
  },

  telegram: {
    shareContactButton: SHARE_CONTACT_BUTTON,
    shareContactPlaceholder: "Toque no botão para compartilhar seu número",
    requestContact:
      "Olá! 👋 Para atender você e proteger suas informações, precisamos verificar seu número. " +
      `Toque no botão «${SHARE_CONTACT_BUTTON}» que aparece abaixo.`,
    identified:
      "Pronto! ✅ Seu número foi verificado. Conte para nós como podemos ajudar.\n\n" +
      "📎 Dica: quando pedirmos documentos ou comprovantes, envie-os como *arquivo* " +
      "(clipe → Arquivo) para que cheguem nítidos.",
    rejection: {
      NOT_OWN_CONTACT:
        "Só podemos verificar o SEU próprio número. Por favor, use o botão " +
        `«${SHARE_CONTACT_BUTTON}» em vez de enviar um contato salvo.`,
      INVALID_PHONE:
        "Não conseguimos ler seu número. Por favor, tente novamente com o botão " +
        `«${SHARE_CONTACT_BUTTON}».`,
    },
  },
};
