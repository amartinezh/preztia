import { useState } from "react";
import type { SendReminderOutput } from "@preztiaos/contracts";
import { Button, Card, ErrorState, Modal, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { ConversationHistory } from "@/features/conversations/components/conversation-history";
import { useCreditCollection, useSendCollectionReminder } from "../api/queries";

// Texto de retroalimentación tras el envío manual, según el resultado del caso de uso.
function reminderFeedback(result: SendReminderOutput): string {
  if (result.sent) return "✅ Recordatorio enviado por WhatsApp.";
  switch (result.reason) {
    case "ALREADY_SENT_TODAY":
      return "Ya se envió un recordatorio a este cliente hoy.";
    case "NOTHING_DUE":
      return "El cliente no tiene cuota por cobrar hoy.";
    case "NO_PIX_KEY":
      return "Configura la llave PIX del tenant (Ajustes) para poder cobrar.";
    case "NO_ACTIVE_CREDIT":
      return "El cliente no tiene un crédito activo o teléfono registrado.";
    default:
      return "No se pudo enviar el recordatorio.";
  }
}

/**
 * Cobranza por WhatsApp en la vista de Cartera/Gestión de Créditos: muestra la cuota de HOY,
 * permite al coordinador disparar el recordatorio de forma manual e inmediata y renderiza el
 * historial del hilo de conversación con el cliente. El llamador decide la visibilidad por rol
 * (`application:review`). Reutilizable en el detalle de cuenta y en el de cartera del crédito.
 */
export function CollectionSection({ creditId }: { creditId: string }) {
  const panel = useCreditCollection(creditId);
  const send = useSendCollectionReminder(creditId);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (panel.isPending) return <Spinner label="Cargando cobranza…" />;
  if (panel.isError) {
    return (
      <ErrorState
        title="Cobranza"
        description="No se pudo cargar la cobranza."
        onRetry={() => panel.refetch()}
      />
    );
  }

  const { firstName, phone, phoneMasked, dueMinor, currency, pixConfigured } = panel.data;
  const canSend = pixConfigured && dueMinor > 0;

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">Cobranza por WhatsApp</Text>
        <Row className="justify-between">
          <Text variant="label" tone="muted">
            Cuota de hoy · {firstName}
          </Text>
          <MoneyText variant="label" amountMinor={dueMinor} currency={currency} />
        </Row>

        <Button
          label="Enviar recordatorio de cobro"
          block
          loading={send.isPending}
          disabled={!canSend}
          onPress={() => send.mutate()}
        />
        <Button
          label="Ver conversación"
          variant="secondary"
          block
          onPress={() => setHistoryOpen(true)}
        />
        {!pixConfigured ? (
          <Text variant="caption" tone="muted">
            Configura la llave PIX del tenant (Ajustes) para habilitar el cobro.
          </Text>
        ) : null}
        {send.data ? (
          <Text variant="caption" tone={send.data.sent ? "primary" : "muted"}>
            {reminderFeedback(send.data)}
          </Text>
        ) : null}
      </Stack>

      {/* Hilo completo de WhatsApp en un modal con scroll (el Modal ya scrollea su cuerpo). */}
      <Modal
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={`Conversación${phoneMasked ? ` · ${phoneMasked}` : ""}`}
      >
        <Stack gap="xs" className="p-4">
          <ConversationHistory phone={phone} />
        </Stack>
      </Modal>
    </Card>
  );
}
