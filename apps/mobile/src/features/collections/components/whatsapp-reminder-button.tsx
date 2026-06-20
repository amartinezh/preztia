import { ActivityIndicator, Alert, Pressable } from "react-native";
import type { SendReminderOutput } from "@preztiaos/contracts";

import { useSendCollectionReminder } from "../api/queries";
import { WhatsappLogo } from "./whatsapp-logo";

// Mensaje de resultado para el aviso tras tocar el botón en el listado.
function feedback(result: SendReminderOutput): { title: string; message: string } {
  if (result.sent) {
    return { title: "Enviado ✅", message: "El recordatorio de cobro salió por WhatsApp." };
  }
  const reason: Record<NonNullable<SendReminderOutput["reason"]>, string> = {
    ALREADY_SENT_TODAY: "Ya se envió un recordatorio a este cliente hoy.",
    NOTHING_DUE: "El cliente no tiene cuota por cobrar hoy.",
    NO_PIX_KEY: "Configura la llave PIX del tenant (Ajustes) para poder cobrar.",
    NO_ACTIVE_CREDIT: "El cliente no tiene un crédito activo o teléfono registrado.",
  };
  return {
    title: "No se envió",
    message: result.reason ? reason[result.reason] : "No se pudo enviar el recordatorio.",
  };
}

/**
 * Botón cuadrado con la identidad de WhatsApp (verde de marca) para disparar el recordatorio de
 * cobro de un crédito desde el LISTADO de Cartera, sin entrar al detalle. Cada fila monta su propia
 * mutación. El resultado se informa con un aviso. El envío es idempotente (1 por crédito y día).
 */
export function WhatsappReminderButton({ creditId }: { creditId: string }) {
  const send = useSendCollectionReminder(creditId);

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
      accessibilityLabel="Enviar recordatorio de cobro por WhatsApp"
      accessibilityState={{ busy: send.isPending }}
      disabled={send.isPending}
      onPress={onPress}
      // Verde oficial de WhatsApp (#25D366); cuadrado redondeado con hit target ≥ 44px.
      className="h-12 w-12 items-center justify-center rounded-xl bg-[#25D366] active:opacity-80 disabled:opacity-50 web:transition-opacity"
    >
      {send.isPending ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <WhatsappLogo size={24} color="#ffffff" />
      )}
    </Pressable>
  );
}
