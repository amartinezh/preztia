import { useEffect } from "react";
import { Alert, Image, Linking, View } from "react-native";
import { Button, Modal, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useDocumentOriginal, useReExtractDocument } from "../api/queries";
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
  const reExtract = useReExtractDocument(applicationId);
  const url = query.data?.url;

  // Nueva pasada de IA sobre este documento; informa el resultado y refresca el detalle.
  const onReExtract = () => {
    if (!documentType) return;
    reExtract.mutate(documentType, {
      onSuccess: (result) =>
        Alert.alert(
          result.extracted ? "Lectura completada" : "No se pudo leer",
          result.extracted
            ? `IA identificó: ${result.identifiedType ?? "—"} · Confianza ${result.confidence ?? 0}%`
            : (result.reason ?? "Inténtalo de nuevo."),
        ),
      onError: () => Alert.alert("Error", "No se pudo reintentar la lectura con IA."),
    });
  };

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

        {/* Nueva pasada de IA: cuando la extracción automática no leyó bien el documento. */}
        <View className="pt-4">
          <Button
            label="Reintentar lectura con IA"
            block
            loading={reExtract.isPending}
            onPress={onReExtract}
          />
          <Text variant="caption" tone="muted" className="pt-2">
            Vuelve a pasar el documento por la IA si no identificó bien la información.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
