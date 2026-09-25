import { DomainError } from "../shared/money";
import type { MessagingProvider } from "../conversations/messaging-channel";

/**
 * Proveedores de mensajería que el tenant opera (ADR #40): WhatsApp, Telegram o ambos. Cada zona
 * configura después SU número/bot; aquí solo se decide qué proveedores están activos en la empresa
 * y por cuál se prefieren los mensajes proactivos (cobranza) cuando el cliente es alcanzable por ambos.
 *
 * Invariantes:
 *   · al menos un proveedor habilitado (un tenant sin canales no podría atender ni cobrar);
 *   · el proveedor preferido para proactivos está habilitado.
 */
export interface MessagingChannelsSettings {
  readonly whatsappEnabled: boolean;
  readonly telegramEnabled: boolean;
  readonly preferredProactiveChannel: MessagingProvider;
}

/** Por defecto solo WhatsApp: es el comportamiento de todos los tenants anteriores a Telegram. */
export const DEFAULT_MESSAGING_CHANNELS: MessagingChannelsSettings = {
  whatsappEnabled: true,
  telegramEnabled: false,
  preferredProactiveChannel: "WHATSAPP",
};

/** ¿El proveedor está habilitado en el tenant? */
export function isProviderEnabled(
  settings: MessagingChannelsSettings,
  provider: MessagingProvider,
): boolean {
  return provider === "WHATSAPP" ? settings.whatsappEnabled : settings.telegramEnabled;
}

/**
 * Aplica un parche parcial y valida el resultado. Falla rápido (DomainError) si deja al tenant sin
 * proveedores o con el preferido deshabilitado: el operador debe cambiar ambos en el mismo parche.
 */
export function mergeMessagingChannels(
  current: MessagingChannelsSettings,
  patch: Partial<MessagingChannelsSettings>,
): MessagingChannelsSettings {
  const next: MessagingChannelsSettings = { ...current, ...patch };
  if (!next.whatsappEnabled && !next.telegramEnabled) {
    throw new DomainError(
      "Debe quedar al menos un canal de mensajería habilitado",
      "MESSAGING_CHANNEL_REQUIRED",
    );
  }
  if (!isProviderEnabled(next, next.preferredProactiveChannel)) {
    throw new DomainError(
      "El canal preferido para cobranza debe estar habilitado",
      "PREFERRED_CHANNEL_DISABLED",
    );
  }
  return next;
}
