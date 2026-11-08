import { useState } from "react";
import { ActivityIndicator, Pressable } from "react-native";
import type { SendReminderOutput } from "@preztiaos/contracts";
import { ConfirmModal, useToast, type ToastInput } from "@preztiaos/ui";

import { useT, type MessageKey } from "@/core/i18n";
import { useMessagingChannels } from "@/features/settings/api/queries";
import { useSendCollectionReminder } from "../api/queries";
import { SendPlaneIcon } from "./send-plane-icon";
import { WhatsappLogo } from "./whatsapp-logo";

// Identidad del botón según los canales del tenant: hoy solo WhatsApp conserva su verde de marca.
const WHATSAPP_GREEN = "bg-[#25D366]";
const TELEGRAM_BLUE = "bg-[#229ED9]";
const NEUTRAL = "bg-zinc-800 dark:bg-zinc-700";

// Por qué el servidor no envió el recordatorio, en palabras del operador.
const REASON_KEY: Record<NonNullable<SendReminderOutput["reason"]>, MessageKey> = {
  ALREADY_SENT_TODAY: "reminder.reason.ALREADY_SENT_TODAY",
  NOTHING_DUE: "reminder.reason.NOTHING_DUE",
  NO_PIX_KEY: "reminder.reason.NO_PIX_KEY",
  NO_ACTIVE_CREDIT: "reminder.reason.NO_ACTIVE_CREDIT",
  NO_REACHABLE_CHANNEL: "reminder.reason.NO_REACHABLE_CHANNEL",
};

// Nombre del canal por el que salió el recordatorio (el servidor elige el alcanzable).
function channelName(result: SendReminderOutput): string {
  return result.channel === "TELEGRAM" ? "Telegram" : "WhatsApp";
}

// Aviso de resultado tras confirmar el envío desde el listado.
function feedback(result: SendReminderOutput, { t, tf }: ReturnType<typeof useT>): ToastInput {
  if (result.sent) {
    return {
      tone: "success",
      title: t("reminder.sentTitle"),
      description: tf("reminder.sentBody", { channel: channelName(result) }),
    };
  }
  return {
    tone: "warning",
    title: t("reminder.notSentTitle"),
    description: result.reason ? t(REASON_KEY[result.reason]) : t("reminder.failed"),
  };
}

/**
 * Botón cuadrado para disparar el recordatorio de cobro de un crédito desde el LISTADO de Cartera,
 * sin entrar al detalle. Toma la identidad del canal del tenant: verde de WhatsApp, azul de
 * Telegram, o neutro si opera ambos (el servidor elige el canal alcanzable de cada cliente). Cada fila monta su propia
 * mutación. Pide confirmación antes de enviar y el resultado se informa con un aviso (toast).
 * El envío es idempotente (1 por crédito y día).
 */
export function WhatsappReminderButton({ creditId }: { creditId: string }) {
  const i18n = useT();
  const { t } = i18n;
  const toast = useToast();
  const send = useSendCollectionReminder(creditId);
  const [confirming, setConfirming] = useState(false);
  // Mientras carga (o si el rol no puede leerla) se asume lo previo a Telegram: solo WhatsApp.
  const channels = useMessagingChannels();
  const onlyWhatsapp = !(channels.data?.telegramEnabled ?? false);
  const onlyTelegram = !onlyWhatsapp && !(channels.data?.whatsappEnabled ?? true);
  const background = onlyWhatsapp ? WHATSAPP_GREEN : onlyTelegram ? TELEGRAM_BLUE : NEUTRAL;

  const sendReminder = () => {
    send.mutate(undefined, {
      onSettled: () => setConfirming(false),
      onSuccess: (result) => toast.show(feedback(result, i18n)),
      onError: () => toast.show({ tone: "danger", title: t("reminder.failed") }),
    });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={onlyWhatsapp ? t("reminder.a11y.whatsapp") : t("reminder.a11y.generic")}
        accessibilityState={{ busy: send.isPending }}
        disabled={send.isPending}
        onPress={() => setConfirming(true)}
        // Cuadrado redondeado con hit target ≥ 44px, del color del canal.
        className={`h-12 w-12 items-center justify-center rounded-xl ${background} active:opacity-80 disabled:opacity-50 web:transition-opacity`}
      >
        {send.isPending ? (
          <ActivityIndicator color="#ffffff" />
        ) : onlyWhatsapp ? (
          <WhatsappLogo size={24} color="#ffffff" />
        ) : (
          <SendPlaneIcon size={24} color="#ffffff" />
        )}
      </Pressable>
      <ConfirmModal
        visible={confirming}
        title={t("reminder.confirmTitle")}
        description={t("reminder.confirmBody")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        loading={send.isPending}
        onConfirm={sendReminder}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
