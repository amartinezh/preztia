// Dominio puro de las LISTAS PERSONALIZADAS de clientes ("Listas Personalizadas" del legado):
// agrupaciones nombradas de clientes para segmentar la cartera. Sin I/O ni framework.

import { DomainError } from "../shared/money";

const NAME_MAX = 80;

/** Nombre de lista no vacío y de longitud acotada; falla rápido si no. */
export function assertListName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new DomainError("El nombre de la lista no puede estar vacío");
  }
  if (trimmed.length > NAME_MAX) {
    throw new DomainError(`El nombre de la lista excede ${NAME_MAX} caracteres`);
  }
}
