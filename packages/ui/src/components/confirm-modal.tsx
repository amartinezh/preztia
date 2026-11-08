import { type ReactNode } from "react";
import { Text } from "../primitives/text";
import { Stack, Row } from "../primitives/stack";
import { Button } from "./button";
import { Modal } from "./modal";

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  /** Resumen de lo que va a pasar (montos, fechas, "no se puede deshacer"). */
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` para borrar o sellar algo irreversible; `primary` para confirmar un envío. */
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Contenido adicional (p. ej. una tabla de montos) entre la descripción y los botones. */
  children?: ReactNode;
  closeLabel?: string;
};

/**
 * Confirmación explícita antes de una acción destructiva o irreversible (borrar, sellar un arqueo,
 * cerrar un período, recibir con faltante). Siempre dice QUÉ va a pasar y ofrece cancelar;
 * mientras `loading` no deja confirmar dos veces. Presentación pura.
 */
export function ConfirmModal({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  loading = false,
  onConfirm,
  onCancel,
  children,
  closeLabel,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} onClose={onCancel} title={title} closeLabel={closeLabel}>
      <Stack gap="lg" className="p-4">
        {description ? <Text>{description}</Text> : null}
        {children}
        <Row gap="sm" className="justify-end">
          <Button label={cancelLabel} variant="secondary" onPress={onCancel} disabled={loading} />
          <Button
            label={confirmLabel}
            variant={tone === "danger" ? "danger" : "primary"}
            loading={loading}
            onPress={onConfirm}
          />
        </Row>
      </Stack>
    </Modal>
  );
}
