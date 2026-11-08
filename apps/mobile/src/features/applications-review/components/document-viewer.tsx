import { useEffect, useState } from "react";
import { Image, Linking, View } from "react-native";
import type { BusinessPhotoVerdict } from "@preztiaos/contracts";
import { Banner, Button, Modal, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useDocumentOriginal, useReExtractDocument, type DocumentFileRef } from "../api/queries";
import { AntifraudVisionPanel } from "./antifraud-vision-panel";
import { reExtractionFeedback, type ReExtractionFeedback } from "./re-extraction-feedback";
import { documentLabel } from "./review-status";

type Props = {
  applicationId: string;
  file: DocumentFileRef | null; // null = cerrado
  // Dictamen de visión cuando el documento abierto es la foto del negocio (BUSINESS_PHOTO).
  visionVerdict?: BusinessPhotoVerdict | null;
  onClose: () => void;
};

/**
 * Visor del documento ORIGINAL subido por el cliente. Descarga el binario descifrado del
 * backend (autenticado) como objectURL y lo muestra: imagen inline cuando el mime es de
 * imagen; en otro caso (PDF, etc.) ofrece abrir en el navegador. Libera el objectURL al
 * cambiar/cerrar (no deja PII en memoria).
 */
export function DocumentViewer({ applicationId, file, visionVerdict, onClose }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const documentType = file?.documentType ?? null;
  const query = useDocumentOriginal(applicationId, file);
  const reExtract = useReExtractDocument(applicationId);
  const url = query.data?.url;
  const isBusinessPhoto = documentType === "BUSINESS_PHOTO";
  // Desenlace de la última pasada de IA. Va como Banner DENTRO del visor: este ya es un modal y un
  // toast quedaría tapado por él en nativo (`Alert.alert`, además, no hace nada en web).
  const [feedback, setFeedback] = useState<ReExtractionFeedback | null>(null);

  // Nueva pasada de IA sobre este documento; informa el resultado y refresca el detalle.
  const onReExtract = () => {
    if (!documentType) return;
    setFeedback(null);
    reExtract.mutate(documentType, {
      onSuccess: (result) => setFeedback(reExtractionFeedback(result, i18n)),
      onError: () => setFeedback({ tone: "danger", title: t("review.docs.retryFailed") }),
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
      title={
        documentType
          ? // Con varios archivos, el título dice cuál se está viendo (1 = anverso).
            `${documentLabel(documentType)}${file && file.slot > 1 ? ` · archivo ${file.slot}` : ""}`
          : t("review.original.title")
      }
      closeLabel={t("common.close")}
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

        {/* Análisis antifraude por visión (solo la foto del negocio), junto a la imagen. */}
        {visionVerdict ? (
          <View className="pt-4">
            <AntifraudVisionPanel verdict={visionVerdict} />
          </View>
        ) : null}

        {/* Nueva pasada de IA: re-leer un documento o re-estudiar la foto del negocio. */}
        <View className="pt-4">
          {feedback ? (
            <View className="pb-3">
              <Banner
                tone={feedback.tone}
                title={feedback.title}
                {...(feedback.description ? { description: feedback.description } : {})}
              />
            </View>
          ) : null}
          <Button
            label={isBusinessPhoto ? "Re-estudiar con IA" : "Reintentar lectura con IA"}
            block
            loading={reExtract.isPending}
            onPress={onReExtract}
          />
          <Text variant="caption" tone="muted" className="pt-2">
            {isBusinessPhoto
              ? "Vuelve a analizar la foto del local con IA de visión si el dictamen no es correcto."
              : "Vuelve a pasar el documento por la IA si no identificó bien la información."}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
