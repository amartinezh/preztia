import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { requiredDocumentType } from "./credit-application-review";

const c = initContract();

// Catálogo POR TENANT de documentos que el bot pide al iniciar una solicitud de crédito. Es lo
// que alimenta el protocolo de recolección; sin documentos activos, el asistente no pide nada.
// Solo el ADMIN lo administra.

export const documentRequirement = z.object({
  documentKey: requiredDocumentType,
  // Texto que ve el usuario en el chat al pedir el documento.
  title: z.string().min(1).max(300),
  // Pista para que la IA identifique el documento recibido.
  description: z.string().min(1).max(1000),
  // Orden de solicitud (menor se pide primero).
  sortOrder: z.number().int().min(0),
  active: z.boolean(),
});
export type DocumentRequirement = z.infer<typeof documentRequirement>;

export const documentRequirementsList = z.object({
  items: z.array(documentRequirement),
});
export type DocumentRequirementsList = z.infer<typeof documentRequirementsList>;

// Reemplaza el catálogo por la lista provista: hace upsert de cada `documentKey` y desactiva los
// que no estén. `documentKey` no se repite dentro de la lista.
export const setDocumentRequirementsInput = z
  .object({ items: z.array(documentRequirement).max(20) })
  .refine(
    (v) => new Set(v.items.map((i) => i.documentKey)).size === v.items.length,
    { message: "No se permiten documentos repetidos" },
  );
export type SetDocumentRequirementsInput = z.infer<typeof setDocumentRequirementsInput>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const creditDocumentRequirementsContract = c.router({
  getDocumentRequirements: {
    method: "GET",
    path: "/credit-document-requirements",
    headers: tenantHeaders,
    responses: { 200: documentRequirementsList },
    summary: "Catálogo de documentos requeridos del tenant",
  },
  setDocumentRequirements: {
    method: "PUT",
    path: "/credit-document-requirements",
    headers: tenantHeaders,
    body: setDocumentRequirementsInput,
    responses: { 200: documentRequirementsList },
    summary: "Define el catálogo de documentos requeridos del tenant (ADMIN)",
  },
});
