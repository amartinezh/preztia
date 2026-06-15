import { useEffect } from "react";
import { Image, Linking, View } from "react-native";
import { Button, Modal, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useDocumentOriginal } from "../api/queries";
import { documentLabel } from "./review-status";

type Props = {
  applicationId: string;
  documentType: string | null; // null = cerrado
  onClose: () => void;
};

/**
 * Visor del documento ORIGINAL subido por el cliente. Descarga el binario descifrado del
 * backend (autenticado) como objectURL y lo muestra: imagen inline cuando el mime es de
 * imagen; en otro caso (PDF, etc.) ofrece abrir en el navegador. Libera el objectURL al
 * cambiar/cerrar (no deja PII en memoria).
 */
export function DocumentViewer({ applicationId, documentType, onClose }: Props) {
  const { t } = useT();
  const query = useDocumentOriginal(applicationId, documentType);
  const url = query.data?.url;

  // Limpieza: revoca el objectURL cuando cambia o se desmonta (sin setState).
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <Modal
      visible={documentType != null}
      onClose={onClose}
      title={documentType ? documentLabel(documentType) : t("review.original.title")}
    >
      <View className="p-4">
        {query.isPending ? <Spinner label={t("common.loading")} /> : null}
        {query.isError ? <Text tone="danger">{t("errors.network")}</Text> : null}
        {query.isSuccess ? (
          query.data.mimeType.startsWith("image/") ? (
            <Image
              source={{ uri: query.data.url }}
              resizeMode="contain"
              className="h-[420px] w-full rounded-xl bg-zinc-100 dark:bg-zinc-800"
            />
          ) : (
            <Stack gap="md" className="items-center py-8">
              <Text tone="muted" className="text-center">
                {t("review.original.unsupported")}
              </Text>
              <Button
                label={t("review.detail.viewOriginal")}
                variant="secondary"
                onPress={() => void Linking.openURL(query.data.url)}
              />
            </Stack>
          )
        ) : null}
      </View>
    </Modal>
  );
}
