import { View } from "react-native";
import { Banner, Button, Modal, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

export type DeletionMode = "selection" | "purge";

type Props = {
  mode: DeletionMode | null;
  /** Cuántas conversaciones se van a borrar (solo aplica al borrado por selección). */
  count: number;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Confirmación de una depuración. El borrado no se puede deshacer, así que la acción destructiva
 * exige un gesto explícito y avisa de la excepción: las conversaciones que respaldan un crédito
 * aprobado se conservan siempre (evidencia de originación).
 */
export function DeletionConfirmModal({
  mode,
  count,
  pending,
  error,
  onConfirm,
  onClose,
}: Props) {
  const { t } = useT();
  if (mode === null) return null;
  const purging = mode === "purge";

  return (
    <Modal
      visible
      onClose={onClose}
      title={t(purging ? "inbox.confirm.purgeTitle" : "inbox.confirm.deleteTitle")}
    >
      <View className="p-4">
        <Stack gap="lg">
          <Text variant="body">
            {t(purging ? "inbox.confirm.purgeBody" : "inbox.confirm.deleteBody")}
          </Text>
          {!purging ? (
            <Text variant="label" tone="danger">
              {count} {t("inbox.selected")}
            </Text>
          ) : null}
          <Banner tone="warning" title={t("inbox.confirm.protected")} />
          {error ? <Banner tone="danger" title={error} /> : null}
          <Stack gap="sm">
            <Button
              label={t("common.delete")}
              variant="danger"
              block
              loading={pending}
              onPress={onConfirm}
            />
            <Button label={t("common.cancel")} variant="secondary" block onPress={onClose} />
          </Stack>
        </Stack>
      </View>
    </Modal>
  );
}
