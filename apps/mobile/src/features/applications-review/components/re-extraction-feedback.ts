import type { ReExtractDocumentOutput } from "@preztiaos/contracts";

import type { useT } from "@/core/i18n";

/** Aviso al analista; su forma coincide con `Banner` y con `ToastInput` (título, detalle, tono). */
export type ReExtractionFeedback = {
  tone: "success" | "warning" | "danger";
  title: string;
  description?: string;
};

/**
 * Desenlace de una nueva pasada de IA sobre un documento: leída (qué identificó y con qué confianza)
 * o no leída (por qué). Función pura compartida por la tabla de documentos y el visor.
 */
export function reExtractionFeedback(
  result: ReExtractDocumentOutput,
  { t, tf }: ReturnType<typeof useT>,
): ReExtractionFeedback {
  if (result.extracted) {
    return {
      tone: "success",
      title: t("review.docs.retryDone"),
      description: tf("review.docs.identified", {
        type: result.identifiedType ?? "—",
        confidence: result.confidence ?? 0,
      }),
    };
  }
  return {
    tone: "warning",
    title: t("review.docs.notReadTitle"),
    description: result.reason ?? t("review.docs.tryAgain"),
  };
}
