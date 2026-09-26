import { Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Button, Row, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import type { PickedFile } from "@/core/api/multipart";

const PREVIEW_SIZE = 160;
// Compresión moderada: el recibo sigue legible y la subida es liviana en datos móviles.
const PHOTO_QUALITY = 0.6;

/**
 * Comprobante (gasto, consignación): foto con la cámara o desde la galería (en web, el selector de
 * archivos).
 * Muestra una vista previa; el servidor valida tipo y tamaño. Si se niega el permiso de cámara, lo
 * informa sin romper el formulario (la galería sigue disponible).
 */
export function ReceiptPicker({
  value,
  onChange,
  onError,
}: {
  value: PickedFile | null;
  onChange: (receipt: PickedFile) => void;
  onError: (message: string) => void;
}) {
  const { t } = useT();

  const pick = async (source: "camera" | "library") => {
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError(t("cash.expenses.receipt.cameraDenied"));
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: PHOTO_QUALITY };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const mimeType = asset.mimeType ?? "image/jpeg";
    onChange({
      uri: asset.uri,
      mimeType,
      fileName: asset.fileName ?? `recibo.${mimeType.split("/")[1] ?? "jpg"}`,
    });
  };

  return (
    <Stack gap="xs">
      <Text variant="label">
        {t("cash.expenses.receipt")} <Text tone="danger">*</Text>
      </Text>
      <Row gap="sm" className="flex-wrap">
        <Button label={t("cash.expenses.receipt.camera")} variant="secondary" size="sm" onPress={() => void pick("camera")} />
        <Button label={t("cash.expenses.receipt.library")} variant="secondary" size="sm" onPress={() => void pick("library")} />
      </Row>
      {value ? (
        <Image
          source={{ uri: value.uri }}
          resizeMode="cover"
          className="rounded-xl bg-zinc-100 dark:bg-zinc-800"
          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
          accessibilityLabel={t("cash.expenses.receipt")}
        />
      ) : (
        <Text variant="caption" tone="muted">
          {t("cash.expenses.receipt.required")}
        </Text>
      )}
    </Stack>
  );
}
