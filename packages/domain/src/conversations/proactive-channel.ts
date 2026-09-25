import { channelProviderOf, type MessagingProvider } from "./messaging-channel";
import {
  isProviderEnabled,
  type MessagingChannelsSettings,
} from "../tenant/messaging-channels";

/**
 * Canal por el que se le puede ESCRIBIR a un cliente por iniciativa propia (recordatorio de cobro,
 * oferta de plan, aviso de crédito registrado o de pago conciliado). ADR #40, D8.
 *
 * `reachable` lo determina la infraestructura según el proveedor:
 *   · WhatsApp: el número sigue vinculado al tenant.
 *   · Telegram: el cliente compartió su contacto con ESE bot y no lo bloqueó (un bot no puede
 *     iniciar conversación con quien nunca le escribió).
 */
export interface ChannelCandidate {
  readonly channelId: string;
  readonly reachable: boolean;
}

export interface ProactiveChannelInput {
  readonly settings: MessagingChannelsSettings;
  /** Canal del último mensaje ENTRANTE del cliente: el que usa activamente. */
  readonly lastInbound: ChannelCandidate | null;
  /** Canal guardado en el agregado (solicitud, pago) por el que empezó la relación. */
  readonly stored: ChannelCandidate | null;
  /** Canales de la zona del crédito/solicitud (a lo sumo uno por proveedor). */
  readonly zone: readonly ChannelCandidate[];
  /** Número de WhatsApp heredado del tenant (antes de los canales por zona); siempre alcanzable. */
  readonly legacyWhatsapp: string | null;
}

/**
 * Elige el canal. Precedencia:
 *   1. el último por el que el cliente escribió (lo está usando; en WhatsApp además suele tener
 *      abierta la ventana de 24 h);
 *   2. el guardado en el agregado;
 *   3. los de la zona, con el proveedor preferido del tenant primero;
 *   4. el número heredado del tenant.
 * Solo cuentan los canales ALCANZABLES de proveedores HABILITADOS. `null` si no hay ninguno: el
 * mensaje se omite con un motivo explícito, nunca se envía a ciegas.
 */
export function chooseProactiveChannel(input: ProactiveChannelInput): string | null {
  const usable = (candidate: ChannelCandidate | null): candidate is ChannelCandidate =>
    candidate !== null &&
    candidate.reachable &&
    isProviderEnabled(input.settings, channelProviderOf(candidate.channelId));

  const preferred = input.settings.preferredProactiveChannel;
  const zoneByPreference = [...input.zone].sort(
    (a, b) => rank(a.channelId, preferred) - rank(b.channelId, preferred),
  );
  const legacy: ChannelCandidate | null = input.legacyWhatsapp
    ? { channelId: input.legacyWhatsapp, reachable: true }
    : null;

  const ordered = [input.lastInbound, input.stored, ...zoneByPreference, legacy];
  return ordered.find(usable)?.channelId ?? null;
}

function rank(channelId: string, preferred: MessagingProvider): number {
  return channelProviderOf(channelId) === preferred ? 0 : 1;
}
