import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, useWindowDimensions } from "react-native";
import { Button, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { SecureFileViewer } from "@/components/secure-file-viewer";
import { fetchSecureFileUrl } from "@/core/api/secure-file";
import { useT } from "@/core/i18n";

const THUMBNAIL_HEIGHT = 180;
const MAX_THUMBNAIL_WIDTH = 480;
// Márgenes del modal (padding exterior + interior) que la miniatura no puede ocupar.
const MODAL_HORIZONTAL_INSET = 64;

/**
 * Miniatura del comprobante DENTRO del modal de decisión (aprobar un gasto, verificar un depósito):
 * quien decide ve el recibo junto a los montos sin salir del modal, y "Ver en grande" abre el visor
 * completo con zoom. Descarga autenticada y descifrada con una consulta PROPIA (distinta de la del
 * visor): así cerrar el visor no libera el objectURL que la miniatura sigue mostrando. El suyo se
 * libera al desmontar (no deja PII en memoria).
 */
export function ReceiptThumbnail({ path, title }: { path: string; title: string }) {
  const { t } = useT();
  const query = useQuery({
    queryKey: ["secure-file", "thumbnail", path],
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async () => fetchSecureFileUrl(path),
  });
  const url = query.data?.url;
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const fitWidth = Math.min(width - MODAL_HORIZONTAL_INSET, MAX_THUMBNAIL_WIDTH);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const isImage = query.data?.mimeType.startsWith("image/") ?? false;

  return (
    <Stack gap="xs">
      <Row className="items-center justify-between">
        <Text variant="label" tone="muted">
          {t("receipt.preview")}
        </Text>
        <Button label={t("receipt.open")} variant="ghost" size="sm" onPress={() => setOpen(true)} />
      </Row>
      {query.isPending ? <Spinner label={t("common.loading")} /> : null}
      {query.isError ? (
        <Text variant="caption" tone="danger">
          {t("receipt.loadFailed")}
        </Text>
      ) : null}
      {query.isSuccess && url ? (
        isImage ? (
          <Image
            source={{ uri: url }}
            resizeMode="contain"
            accessibilityLabel={title}
            className="rounded-xl bg-zinc-100 dark:bg-zinc-800"
            style={{ width: fitWidth, height: THUMBNAIL_HEIGHT }}
          />
        ) : (
          <Text variant="caption" tone="muted">
            {t("receipt.noPreview")}
          </Text>
        )
      ) : null}
      <SecureFileViewer path={open ? path : null} title={title} onClose={() => setOpen(false)} />
    </Stack>
  );
}
