import { channelProviderOf, type MessagingProvider } from '@preztiaos/domain';

/** Drivers registrados por proveedor. Un proveedor ausente aún no tiene integración. */
export type ChannelDrivers<T> = Partial<Record<MessagingProvider, T>>;

/**
 * Elige el driver del proveedor del `channelId` (ADR #40). Falla EXPLÍCITAMENTE si el proveedor no
 * tiene driver: un mensaje a un canal sin integración no se da por enviado en silencio.
 */
export function driverFor<T>(drivers: ChannelDrivers<T>, channelId: string): T {
  const provider = channelProviderOf(channelId);
  const driver = drivers[provider];
  if (!driver) {
    throw new Error(
      `Proveedor de mensajería ${provider} sin integración (canal ${channelId})`,
    );
  }
  return driver;
}
