import { useState } from "react";
import { ScrollView } from "react-native";
import type { UpdateChannelInput, WhatsappChannel, ZoneNode } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Field,
  Input,
  Modal,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { env } from "@/core/env";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCreateChannel,
  useDeleteChannel,
  useUpdateChannelCredentials,
  useWhatsappChannels,
} from "@/features/settings/api/queries";
import { useUpdateZone } from "../api/queries";

type CredDraft = {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
};

const EMPTY_DRAFT: CredDraft = { accessToken: "", appSecret: "", verifyToken: "", graphVersion: "" };

/**
 * Solo envía los campos NO vacíos: un campo vacío CONSERVA el valor actual (misma UX que la API key
 * del asistente). Así los secretos nunca se pisan por accidente al guardar otros campos.
 */
function nonEmptyCredentials(d: CredDraft): UpdateChannelInput {
  return {
    ...(d.accessToken.trim() ? { accessToken: d.accessToken.trim() } : {}),
    ...(d.appSecret.trim() ? { appSecret: d.appSecret.trim() } : {}),
    ...(d.verifyToken.trim() ? { verifyToken: d.verifyToken.trim() } : {}),
    ...(d.graphVersion.trim() ? { graphVersion: d.graphVersion.trim() } : {}),
  };
}

/**
 * Copia al portapapeles cuando la plataforma lo permite (web). Devuelve false si no hay
 * portapapeles disponible (nativo sin permiso): la URL queda seleccionable para copiar a mano.
 * Acceso vía globalThis para no depender de los tipos del DOM en el typecheck de React Native.
 */
async function copyToClipboard(text: string): Promise<boolean> {
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

/**
 * Editor de WhatsApp de UNA zona (ADMIN): lista los números vinculados a la zona y permite añadir un
 * número con sus credenciales de Meta o editar las credenciales existentes. Los secretos van
 * cifrados en la BD y jamás vuelven a la app: solo se muestra el estado (`has*`).
 */
export function ZoneWhatsappEditor({
  visible,
  onClose,
  zone,
}: {
  visible: boolean;
  onClose: () => void;
  zone: ZoneNode | null;
}) {
  const { t } = useT();
  const channels = useWhatsappChannels();
  if (!zone) return null;

  const zoneChannels = (channels.data?.items ?? []).filter((c) => c.zoneId === zone.id);

  return (
    <Modal visible={visible} onClose={onClose} title={t("zonesWa.title")}>
      <ScrollView contentContainerClassName="gap-3 p-4">
        <Text variant="caption" tone="muted">
          {zone.name} · {zone.path}
        </Text>
        <Text variant="caption" tone="muted">
          {t("zonesWa.hint")}
        </Text>

        <ZoneSupportPhoneCard zone={zone} />

        {channels.isPending ? <Spinner label={t("common.loading")} /> : null}
        {!channels.isPending && zoneChannels.length === 0 ? (
          <Text tone="muted">{t("zonesWa.empty")}</Text>
        ) : null}

        {zoneChannels.map((ch) => (
          <ChannelCredentialsCard key={ch.id} channel={ch} />
        ))}

        <AddChannelCard zoneId={zone.id} />

        <WebhookSetupCard />

        <Text variant="caption" tone="muted">
          {t("zonesWa.shareHint")}
        </Text>
      </ScrollView>
    </Modal>
  );
}

/**
 * Teléfono de atención al cliente de la zona (ADMIN): número humano que se comparte con el cliente
 * ante inconvenientes. Es un atributo de la zona (updateZone), distinto del phone_number_id de Meta.
 */
function ZoneSupportPhoneCard({ zone }: { zone: ZoneNode }) {
  const { t } = useT();
  const update = useUpdateZone();
  const [phone, setPhone] = useState(zone.supportPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setError(null);
    setSaved(false);
    update.mutate(
      { id: zone.id, name: zone.name, supportPhone: phone.trim() || null },
      {
        onSuccess: () => setSaved(true),
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Stack gap="sm" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      {error ? <Banner tone="danger" title={error} /> : null}
      {saved ? <Banner tone="success" title={t("zones.support.saved")} /> : null}
      <Field label={t("zones.support.label")} hint={t("zones.support.hint")}>
        <Input
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            setSaved(false);
          }}
          keyboardType="phone-pad"
          autoCapitalize="none"
          placeholder={t("zones.support.placeholder")}
        />
      </Field>
      <Button label={t("zones.support.save")} loading={update.isPending} block onPress={save} />
    </Stack>
  );
}

/**
 * Conexión del webhook en Meta: muestra la URL exacta de devolución de llamada (derivada del host
 * del API en runtime, sin hardcodear dominios) y la copia al portapapeles. Esta URL + el Verify
 * token del canal son lo que Meta pide para enlazar los dos sistemas y empezar a recibir mensajes.
 */
function WebhookSetupCard() {
  const { t } = useT();
  const [feedback, setFeedback] = useState<"copied" | "manual" | null>(null);
  const webhookUrl = `${env.apiUrl}/webhooks/whatsapp`;

  const copy = async () => {
    setFeedback((await copyToClipboard(webhookUrl)) ? "copied" : "manual");
  };

  return (
    <Stack gap="sm" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <Text variant="subtitle">{t("zonesWa.webhook.title")}</Text>
      <Text variant="caption" tone="muted">
        {t("zonesWa.webhook.hint")}
      </Text>
      <Text
        variant="code"
        selectable
        className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900"
      >
        {webhookUrl}
      </Text>
      {feedback === "copied" ? <Banner tone="success" title={t("zonesWa.webhook.copied")} /> : null}
      {feedback === "manual" ? (
        <Banner tone="warning" title={t("zonesWa.webhook.copyManual")} />
      ) : null}
      <Button label={t("zonesWa.webhook.copy")} variant="ghost" block onPress={() => void copy()} />
    </Stack>
  );
}

/** Estado de una credencial (configurada o no) sin exponer el secreto. */
function CredentialStatus({ label, has }: { label: string; has: boolean }) {
  const { t } = useT();
  return (
    <Row className="items-center gap-2">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Badge
        label={has ? t("zonesWa.configured") : t("zonesWa.unset")}
        tone={has ? "success" : "neutral"}
      />
    </Row>
  );
}

/** Edición de las credenciales de un número ya vinculado a la zona. */
function ChannelCredentialsCard({ channel }: { channel: WhatsappChannel }) {
  const { t } = useT();
  const update = useUpdateChannelCredentials();
  const remove = useDeleteChannel();
  const [draft, setDraft] = useState<CredDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<CredDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const save = () => {
    setError(null);
    setSaved(false);
    update.mutate(
      { id: channel.id, credentials: nonEmptyCredentials(draft) },
      {
        onSuccess: () => {
          setSaved(true);
          setDraft(EMPTY_DRAFT);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Stack gap="sm" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <Row className="items-center justify-between">
        <Text variant="subtitle">{channel.phoneNumberId}</Text>
        <Button
          label={t("common.delete")}
          variant="ghost"
          size="sm"
          onPress={() => remove.mutate(channel.id)}
        />
      </Row>
      {error ? <Banner tone="danger" title={error} /> : null}
      {saved ? <Banner tone="success" title={t("assistant.saved")} /> : null}

      <CredentialStatus label={t("zonesWa.accessToken")} has={channel.hasAccessToken} />
      <Field label={t("zonesWa.accessToken")} hint={t("zonesWa.accessToken.hint")}>
        <Input
          value={draft.accessToken}
          onChangeText={(v) => set({ accessToken: v })}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
        />
      </Field>

      <CredentialStatus label={t("zonesWa.appSecret")} has={channel.hasAppSecret} />
      <Field label={t("zonesWa.appSecret")} hint={t("zonesWa.appSecret.hint")}>
        <Input
          value={draft.appSecret}
          onChangeText={(v) => set({ appSecret: v })}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
        />
      </Field>

      <CredentialStatus label={t("zonesWa.verifyToken")} has={channel.hasVerifyToken} />
      <Field label={t("zonesWa.verifyToken")} hint={t("zonesWa.verifyToken.hint")}>
        <Input
          value={draft.verifyToken}
          onChangeText={(v) => set({ verifyToken: v })}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
        />
      </Field>

      <Field label={t("zonesWa.graphVersion")} hint={t("zonesWa.graphVersion.hint")}>
        <Input
          value={draft.graphVersion}
          onChangeText={(v) => set({ graphVersion: v })}
          autoCapitalize="none"
          placeholder={channel.graphVersion ?? "v21.0"}
        />
      </Field>

      <Button label={t("zonesWa.save")} loading={update.isPending} block onPress={save} />
    </Stack>
  );
}

/** Alta de un número nuevo para la zona, con sus credenciales de Meta opcionales. */
function AddChannelCard({ zoneId }: { zoneId: string }) {
  const { t } = useT();
  const create = useCreateChannel();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [draft, setDraft] = useState<CredDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<CredDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    setError(null);
    if (!phoneNumberId.trim()) {
      setError(t("errors.validation"));
      return;
    }
    create.mutate(
      { phoneNumberId: phoneNumberId.trim(), zoneId, ...nonEmptyCredentials(draft) },
      {
        onSuccess: () => {
          setPhoneNumberId("");
          setDraft(EMPTY_DRAFT);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Stack gap="sm" className="rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <Text variant="subtitle">{t("zonesWa.add")}</Text>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Field label={t("zonesWa.number")} hint={t("zonesWa.number.hint")}>
        <Input value={phoneNumberId} onChangeText={setPhoneNumberId} autoCapitalize="none" />
      </Field>
      <Field label={t("zonesWa.accessToken")} hint={t("zonesWa.accessToken.hint")}>
        <Input
          value={draft.accessToken}
          onChangeText={(v) => set({ accessToken: v })}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <Field label={t("zonesWa.appSecret")} hint={t("zonesWa.appSecret.hint")}>
        <Input
          value={draft.appSecret}
          onChangeText={(v) => set({ appSecret: v })}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <Field label={t("zonesWa.verifyToken")} hint={t("zonesWa.verifyToken.hint")}>
        <Input
          value={draft.verifyToken}
          onChangeText={(v) => set({ verifyToken: v })}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <Field label={t("zonesWa.graphVersion")} hint={t("zonesWa.graphVersion.hint")}>
        <Input
          value={draft.graphVersion}
          onChangeText={(v) => set({ graphVersion: v })}
          autoCapitalize="none"
          placeholder="v21.0"
        />
      </Field>
      <Button label={t("zonesWa.add")} loading={create.isPending} block onPress={submit} />
    </Stack>
  );
}
