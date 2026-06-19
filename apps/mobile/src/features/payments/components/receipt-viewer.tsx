import { useEffect, useState } from "react";
import { Image, Linking, ScrollView, useWindowDimensions, View } from "react-native";
import { Button, Modal, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { usePaymentReceipt } from "../api/queries";

type Props = {
  paymentId: string | null; // null = cerrado
  onClose: () => void;
};

/**
 * Visor del comprobante de pago. Descarga el binario descifrado (autenticado) como objectURL y lo
 * muestra; permite "ampliar" (zoom básico sin librerías: imagen grande dentro de scroll horizontal
 * y vertical para hacer pan). Libera el objectURL al cerrar (no deja evidencia/PII en memoria).
 */
export function ReceiptViewer({ paymentId, onClose }: Props) {
  const { t } = useT();
  const query = usePaymentReceipt(paymentId);
  const url = query.data?.url;
  const [zoomed, setZoomed] = useState(false);
  // Ancho NUMÉRICO para el modo "ajustar": en RN-web un Image con ancho en % no resuelve dentro
  // del modal y no se pinta; acotado al ancho del modal (máx ~520) para que siempre tenga tamaño.
  const { width } = useWindowDimensions();
  const fitWidth = Math.min(width - 64, 520);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const isImage = query.data?.mimeType.startsWith("image/");

  return (
    <Modal visible={paymentId != null} onClose={onClose} title={t("payment.receipt.title")}>
      <View className="p-4">
        {query.isPending ? <Spinner label={t("common.loading")} /> : null}
        {query.isError ? <Text tone="danger">{t("errors.network")}</Text> : null}
        {query.isSuccess && url ? (
          isImage ? (
            <Stack gap="sm">
              {zoomed ? (
                <ScrollView horizontal className="max-h-[460px] rounded-xl bg-zinc-100 dark:bg-zinc-800">
                  <ScrollView>
                    <Image source={{ uri: url }} resizeMode="contain" style={{ width: 900, height: 900 }} />
                  </ScrollView>
                </ScrollView>
              ) : (
                <Image
                  source={{ uri: url }}
                  resizeMode="contain"
                  className="rounded-xl bg-zinc-100 dark:bg-zinc-800"
                  style={{ width: fitWidth, height: 460 }}
                />
              )}
              <Button
                label={zoomed ? t("payment.receipt.fit") : t("payment.receipt.zoom")}
                variant="secondary"
                size="sm"
                onPress={() => setZoomed((z) => !z)}
              />
            </Stack>
          ) : (
            <Stack gap="md" className="items-center py-8">
              <Text tone="muted" className="text-center">
                {t("review.original.unsupported")}
              </Text>
              <Button
                label={t("review.detail.viewOriginal")}
                variant="secondary"
                onPress={() => void Linking.openURL(url)}
              />
            </Stack>
          )
        ) : null}
      </View>
    </Modal>
  );
}
