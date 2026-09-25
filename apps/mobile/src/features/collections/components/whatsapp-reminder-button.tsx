import { ActivityIndicator, Alert, Pressable } from "react-native";
import type { SendReminderOutput } from "@preztiaos/contracts";

import { useMessagingChannels } from "@/features/settings/api/queries";
import { useSendCollectionReminder } from "../api/queries";
import { SendPlaneIcon } from "./send-plane-icon";
import { WhatsappLogo } from "./whatsapp-logo";

// Identidad del botón según los canales del tenant: hoy solo WhatsApp conserva su verde de marca.
const WHATSAPP_GREEN = "bg-[#25D366]";
const TELEGRAM_BLUE = "bg-[#229ED9]";
const NEUTRAL = "bg-zinc-800 dark:bg-zinc-700";

// Nombre del canal por el que salió el recordatorio (el servidor elige el alcanzable).
function channelName(result: SendReminderOutput): string {
  return result.channel === "TELEGRAM" ? "Telegram" : "WhatsApp";
}

// Mensaje de resultado para el aviso tras tocar el botón en el listado.
function feedback(result: SendReminderOutput): { title: string; message: string } {
  if (result.sent) {
    return { title: "Enviado ✅", message: `El recordatorio de cobro salió por ${channelName(result)}.` };
  }
  const reason: Record<NonNullable<SendReminderOutput["reason"]>, string> = {
    ALREADY_SENT_TODAY: "Ya se envió un recordatorio a este cliente hoy.",
    NOTHING_DUE: "El cliente no tiene cuota por cobrar hoy.",
    NO_PIX_KEY: "Configura la llave PIX del tenant (Ajustes) para poder cobrar.",
    NO_ACTIVE_CREDIT: "El cliente no tiene un crédito activo o teléfono registrado.",
    NO_REACHABLE_CHANNEL: "El cliente no es alcanzable por ningún canal habilitado (p. ej. nunca escribió al bot).",
  };
  return {
    title: "No se envió",
    message: result.reason ? reason[result.reason] : "No se pudo enviar el recordatorio.",
  };
}

/**
 * Botón cuadrado para disparar el recordatorio de cobro de un crédito desde el LISTADO de Cartera,
 * sin entrar al detalle. Toma la identidad del canal del tenant: verde de WhatsApp, azul de
 * Telegram, o neutro si opera ambos (el servidor elige el canal alcanzable de cada cliente). Cada fila monta su propia
 * mutación. El resultado se informa con un aviso. El envío es idempotente (1 por crédito y día).
 */
export function WhatsappReminderButton({ creditId }: { creditId: string }) {
  const send = useSendCollectionReminder(creditId);
  // Mientras carga (o si el rol no puede leerla) se asume lo previo a Telegram: solo WhatsApp.
  const channels = useMessagingChannels();
  const onlyWhatsapp = !(channels.data?.telegramEnabled ?? false);
  const onlyTelegram = !onlyWhatsapp && !(channels.data?.whatsappEnabled ?? true);
  const background = onlyWhatsapp ? WHATSAPP_GREEN : onlyTelegram ? TELEGRAM_BLUE : NEUTRAL;

  const onPress = () => {
    send.mutate(undefined, {
      onSuccess: (result) => {
        const { title, message } = feedback(result);
        Alert.alert(title, message);
      },
      onError: () => Alert.alert("Error", "No se pudo enviar el recordatorio."),
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        onlyWhatsapp ? "Enviar recordatorio de cobro por WhatsApp" : "Enviar recordatorio de cobro"
      }
      accessibilityState={{ busy: send.isPending }}
      disabled={send.isPending}
      onPress={onPress}
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
  );
}
