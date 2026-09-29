/**
 * Copia al portapapeles cuando la plataforma lo permite (web). Devuelve false si no hay
 * portapapeles disponible (nativo sin permiso): el texto queda seleccionable para copiar a mano.
 * Acceso vía globalThis para no depender de los tipos del DOM en el typecheck de React Native.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const nav = (
    globalThis as {
      navigator?: { clipboard?: { writeText(value: string): Promise<void> } };
    }
  ).navigator;
  if (!nav?.clipboard) return false;
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
