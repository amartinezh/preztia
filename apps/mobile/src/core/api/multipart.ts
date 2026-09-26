import { Platform } from "react-native";

/** Archivo elegido en el dispositivo (foto de la cámara/galería o archivo en web). */
export interface PickedFile {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * Agrega un archivo elegido al multipart. En web el archivo es un Blob real (se lee de su
 * objectURL); en nativo, React Native sube el archivo local a partir de `{ uri, name, type }`.
 */
export async function appendPickedFile(form: FormData, field: string, file: PickedFile): Promise<void> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, new File([blob], file.fileName, { type: file.mimeType }));
    return;
  }
  form.append(field, { uri: file.uri, name: file.fileName, type: file.mimeType } as unknown as Blob);
}
