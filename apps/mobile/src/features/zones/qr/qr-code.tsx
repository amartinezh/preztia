import { useMemo } from "react";
import { Platform, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import QRCode from "qrcode";

import { qrPathData, qrViewBoxSize } from "./qr-path";

// Colores fijos (no del tema): un QR sobre fondo oscuro o invertido falla en muchos lectores.
const QR_DARK = "#000000";
const QR_LIGHT = "#ffffff";
// Ancho del PNG para imprimir: nítido en un cartel A5/A4 sin pesar más de unos KB.
const PRINT_WIDTH_PX = 1024;
// Corrección media (~15 %): tolera impresiones gastadas sin volver el código demasiado denso.
const ERROR_CORRECTION = "M";

/** Código QR vectorial (web y nativo) del texto dado, generado en el cliente con `qrcode`. */
export function QrCode({ value, size }: { value: string; size: number }) {
  const { path, viewBox } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: ERROR_CORRECTION });
    return { path: qrPathData(modules), viewBox: qrViewBoxSize(modules) };
  }, [value]);

  return (
    <View accessibilityRole="image" accessibilityLabel={value}>
      <Svg width={size} height={size} viewBox={`0 0 ${viewBox} ${viewBox}`}>
        <Rect width={viewBox} height={viewBox} fill={QR_LIGHT} />
        <Path d={path} fill={QR_DARK} />
      </Svg>
    </View>
  );
}

/** La descarga de archivos solo existe en el navegador; en nativo se comparte el enlace. */
export const canDownloadQr = Platform.OS === "web";

/**
 * Descarga el QR como PNG (web). `toDataURL` usa el `<canvas>` del navegador; el documento se
 * toma de globalThis para no depender de los tipos del DOM en el typecheck de React Native.
 */
export async function downloadQrPng(value: string, fileName: string): Promise<void> {
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: ERROR_CORRECTION,
    width: PRINT_WIDTH_PX,
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
  const doc = (
    globalThis as {
      document?: {
        createElement(tag: "a"): { href: string; download: string; click(): void };
      };
    }
  ).document;
  if (!doc) throw new Error("La descarga del QR solo está disponible en la web");
  const link = doc.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}
