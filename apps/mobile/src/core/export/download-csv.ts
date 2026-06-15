/**
 * Descarga de CSV SIN dependencias nuevas: usa `document` + `URL.createObjectURL` del entorno
 * (disponibles en web y React Native Web). En nativo no existen; `csvDownloadAvailable()` da
 * false y la UI oculta el botón. Para guardar/compartir en iOS/Android se necesitaría
 * `expo-file-system`/`expo-sharing` (dependencias a autorizar); el endpoint del CSV ya está listo.
 */
type WebDoc = {
  createElement: (tag: string) => {
    href: string;
    download: string;
    click: () => void;
  };
  body: { appendChild: (n: unknown) => void; removeChild: (n: unknown) => void };
};
type WebUrl = {
  createObjectURL: (blob: unknown) => string;
  revokeObjectURL: (url: string) => void;
};

function doc(): WebDoc | undefined {
  return (globalThis as unknown as { document?: WebDoc }).document;
}
function urlApi(): WebUrl | undefined {
  return (globalThis as unknown as { URL?: WebUrl }).URL;
}

export function csvDownloadAvailable(): boolean {
  return typeof doc()?.createElement === "function" &&
    typeof urlApi()?.createObjectURL === "function";
}

export function downloadCsv(filename: string, csv: string): void {
  const d = doc();
  const u = urlApi();
  if (!d || !u) return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = u.createObjectURL(blob);
  const link = d.createElement("a");
  link.href = href;
  link.download = filename;
  d.body.appendChild(link);
  link.click();
  d.body.removeChild(link);
  u.revokeObjectURL(href);
}
