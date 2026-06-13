// Reglas forenses sobre la metadata técnica del archivo (Etapa 2, local).
// La metadata la extrae la infraestructura en la Etapa 1 (y queda persistida);
// aquí solo se interpreta: un documento oficial producido por un editor de
// imágenes, o re-modificado mucho después de creado, es señal de adulteración.

import { alerta, type ValidationAlert } from "./alert";
import { parseIsoDateTime } from "./dates";

/** Metadata técnica de un archivo (PDF/imagen), ya normalizada a ISO. */
export interface FileTechnicalMetadata {
  /** Software productor del PDF (campo Producer). */
  readonly producer: string | null;
  /** Herramienta creadora (campo Creator / CreatorTool). */
  readonly creator: string | null;
  /** Software registrado en EXIF (imágenes). */
  readonly software: string | null;
  readonly createDate: string | null;
  readonly modifyDate: string | null;
}

// Editores de imágenes/diseño: legítimos en general, pero NO como productores de
// un documento oficial (CNH, cartão CNPJ, factura de servicio público).
const SUSPICIOUS_EDITORS = [
  "photoshop",
  "canva",
  "gimp",
  "illustrator",
  "pixlr",
  "photopea",
  "paint",
  "inkscape",
] as const;

// Una re-grabación inmediata (conversión, compresión al enviar) es normal; una
// modificación horas o días después de creado el archivo ya no lo es.
const TOLERATED_EDIT_GAP_MS = 60 * 60 * 1000; // 1 hora

function suspiciousEditorIn(value: string | null): string | null {
  if (!value) return null;
  const lowered = value.toLowerCase();
  return SUSPICIOUS_EDITORS.find((editor) => lowered.includes(editor)) ?? null;
}

/** Evalúa la metadata del archivo; sin metadata no se penaliza (no todo formato la trae). */
export function reviewFileMetadata(
  metadata: FileTechnicalMetadata | null,
): ValidationAlert[] {
  if (!metadata) return [];
  const alerts: ValidationAlert[] = [];

  for (const [campo, value] of [
    ["producer", metadata.producer],
    ["creator", metadata.creator],
    ["software", metadata.software],
  ] as const) {
    const editor = suspiciousEditorIn(value);
    if (editor) {
      alerts.push(
        alerta(
          campo,
          "ALTA",
          `el archivo fue producido con un editor de imágenes ("${value}"): un documento oficial no debería generarse con ${editor}`,
        ),
      );
    }
  }

  const created = parseIsoDateTime(metadata.createDate);
  const modified = parseIsoDateTime(metadata.modifyDate);
  if (created && modified && modified.getTime() - created.getTime() > TOLERATED_EDIT_GAP_MS) {
    alerts.push(
      alerta(
        "modifyDate",
        "MEDIA",
        `el archivo fue modificado mucho después de su creación (creado ${metadata.createDate}, modificado ${metadata.modifyDate})`,
      ),
    );
  }

  return alerts;
}
