import { DomainError } from "../shared/money";

// Reglas puras del agregado Tenant (plano de control). El dominio decide qué es un slug
// válido y qué transiciones de estado son legítimas; la persistencia y la unicidad del
// slug viven en infraestructura (control-plane con BYPASSRLS).

/** Estado operativo de un tenant. SUSPENDED bloquea el acceso de sus usuarios. */
export type TenantStatus = "ACTIVE" | "SUSPENDED";

export const TENANT_STATUSES: readonly TenantStatus[] = ["ACTIVE", "SUSPENDED"];

// El slug identifica al tenant en URLs/subdominios: minúsculas, dígitos y guiones, sin
// guiones al inicio/fin. Es estable y legible.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_SLUG_LENGTH = 2;
const MAX_SLUG_LENGTH = 40;

/** Valida el slug del tenant; lanza `DomainError` si no cumple el formato. */
export function assertValidTenantSlug(slug: string): void {
  if (
    slug.length < MIN_SLUG_LENGTH ||
    slug.length > MAX_SLUG_LENGTH ||
    !SLUG_PATTERN.test(slug)
  ) {
    throw new DomainError(
      "El slug del tenant debe ser minúsculas/dígitos/guiones (2-40), sin guiones al borde",
    );
  }
}

/** Deriva un slug candidato a partir de un nombre legible (no garantiza unicidad). */
export function toTenantSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  assertValidTenantSlug(slug);
  return slug;
}

/**
 * ¿Es legítima la transición de estado? Mismo estado es idempotente (permitido);
 * ACTIVE↔SUSPENDED son las únicas transiciones reales. Cualquier otro valor falla rápido.
 */
export function canTransitionTenant(from: TenantStatus, to: TenantStatus): boolean {
  return TENANT_STATUSES.includes(from) && TENANT_STATUSES.includes(to);
}
