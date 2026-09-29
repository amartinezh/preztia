import { useState } from "react";
import { Linking, Share, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import type { TelegramChannel, TelegramWebhookStatus, ZoneNode } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { copyToClipboard } from "@/core/clipboard";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCreateTelegramChannel,
  useDeleteTelegramChannel,
  useRotateTelegramToken,
  useTelegramChannels,
  useVerifyTelegramChannel,
} from "@/features/settings/api/queries";
import { QrCode, canDownloadQr, downloadQrPng } from "../qr/qr-code";

/** Mensaje de error traducido (código de dominio del servidor o genérico por estado). */
function useErrorText() {
  const { t } = useT();
  return (err: unknown) => (isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
}

/**
 * Bot de Telegram de UNA zona (ADMIN, ADR #40). A diferencia de WhatsApp, no hay URL ni verify token
 * que copiar: el ADMIN pega el token de @BotFather y el servidor valida el bot y registra el webhook.
 * El token se guarda cifrado y jamás vuelve a la app; solo se muestra el estado de la conexión.
 */
export function ZoneTelegramSection({ zone, enabled }: { zone: ZoneNode; enabled: boolean }) {
  const { t } = useT();
  const channels = useTelegramChannels();

  if (!enabled) {
    return (
      <Text variant="caption" tone="muted">
        {t("zonesTg.disabled")}
      </Text>
    );
  }
  if (channels.isPending) return <Spinner label={t("common.loading")} />;

  const bot = (channels.data?.items ?? []).find((c) => c.zoneId === zone.id) ?? null;
  return bot ? <TelegramBotCard bot={bot} /> : <LinkTelegramBotCard zoneId={zone.id} />;
}

/** Bot vinculado: enlace/QR para los clientes, estado del webhook, rotación y desconexión. */
function TelegramBotCard({ bot }: { bot: TelegramChannel }) {
  const { t } = useT();
  const errorText = useErrorText();
  const verify = useVerifyTelegramChannel();
  const remove = useDeleteTelegramChannel();
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const onError = (err: unknown) => setError(errorText(err));
  const chatLink = bot.botUsername ? `https://t.me/${bot.botUsername}` : null;
  const tone = bot.webhookRegistered ? CONNECTED_CARD : DISCONNECTED_CARD;

  return (
    <Stack gap="md">
      <Stack gap="md" className={`rounded-2xl border p-4 ${tone}`}>
        <BotHeader bot={bot} />
        {chatLink ? <ChatLinkShare link={chatLink} username={bot.botUsername ?? ""} /> : null}
        <WebhookStatus registered={bot.webhookRegistered} status={verify.data ?? null} />
        {error ? <Banner tone="danger" title={error} /> : null}
        {confirmUnlink ? <Banner tone="warning" title={t("zonesTg.unlink.confirm")} /> : null}
        <Row className="flex-wrap gap-2">
          <Button
            label={t("zonesTg.verify")}
            variant="secondary"
            loading={verify.isPending}
            onPress={() => {
              setError(null);
              verify.mutate(bot.id, { onError });
            }}
          />
          <Button
            label={t("zonesTg.unlink")}
            variant={confirmUnlink ? "danger" : "secondary"}
            loading={remove.isPending}
            onPress={() => {
              if (!confirmUnlink) {
                setConfirmUnlink(true);
                return;
              }
              remove.mutate(bot.id, { onError });
            }}
          />
        </Row>
      </Stack>
      <RotateTokenForm botId={bot.id} />
    </Stack>
  );
}

const CONNECTED_CARD =
  "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30";
const DISCONNECTED_CARD =
  "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30";
const QR_SIZE_PX = 160;
const CHECK_ICON_PX = 20;

/** Encabezado: estado, @bot, token enmascarado (•••KxC0) y desde cuándo está conectado. */
function BotHeader({ bot }: { bot: TelegramChannel }) {
  const { t } = useT();
  const connectedAt = new Date(bot.createdAt).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Row className="flex-wrap items-center gap-x-2 gap-y-1">
      <StatusIcon ok={bot.webhookRegistered} />
      <Text variant="heading">
        {bot.webhookRegistered ? t("zonesTg.webhook.ok") : t("zonesTg.webhook.missing")}
      </Text>
      <Text tone="muted">· {bot.botUsername ? `@${bot.botUsername}` : bot.channelId}</Text>
      <Text variant="code" tone="muted">
        · {t("zonesTg.tokenMasked")} •••{bot.tokenLast4}
      </Text>
      <Text variant="caption" tone="muted">
        · {t("zonesTg.connectedAt")} {connectedAt}
      </Text>
    </Row>
  );
}

/** Círculo con check (conectado) o signo de exclamación (sin webhook), en SVG sin assets. */
function StatusIcon({ ok }: { ok: boolean }) {
  const color = ok ? "#059669" : "#d97706";
  return (
    <Svg width={CHECK_ICON_PX} height={CHECK_ICON_PX} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} />
      <Path
        d={ok ? "m8 12.5 2.5 2.5L16 9.5" : "M12 7v6m0 3.5v.5"}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Enlace t.me del bot y su QR, para que los clientes abran el chat sin buscarlo. En web se copia al
 * portapapeles y el QR se descarga en PNG para imprimir; en nativo se usa la hoja de compartir.
 */
function ChatLinkShare({ link, username }: { link: string; username: string }) {
  const { t } = useT();
  const [feedback, setFeedback] = useState<"copied" | "downloadFailed" | null>(null);

  const copy = async () => {
    if (await copyToClipboard(link)) {
      setFeedback("copied");
      return;
    }
    await Share.share({ message: link });
  };
  const download = async () => {
    setFeedback(null);
    try {
      await downloadQrPng(link, `telegram-${username}.png`);
    } catch {
      setFeedback("downloadFailed");
    }
  };

  return (
    <Stack gap="sm">
      <Text variant="caption" tone="muted">
        {t("zonesTg.share.hint")}
      </Text>
      <Row className="flex-wrap items-center gap-2">
        <Text
          variant="code"
          selectable
          className="min-w-[200px] flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {link}
        </Text>
        <Button label={t("zonesTg.share.copy")} variant="secondary" size="sm" onPress={() => void copy()} />
        <Button
          label={t("zonesTg.share.open")}
          variant="secondary"
          size="sm"
          onPress={() => void Linking.openURL(link)}
        />
      </Row>
      {feedback === "copied" ? <Banner tone="success" title={t("zonesTg.share.copied")} /> : null}

      <Row className="flex-wrap items-center gap-4">
        <View className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800">
          <QrCode value={link} size={QR_SIZE_PX} />
        </View>
        <Stack gap="sm" className="min-w-[200px] flex-1">
          <Text variant="caption" tone="muted">
            {t("zonesTg.qr.hint")}
          </Text>
          {canDownloadQr ? (
            <Button
              label={t("zonesTg.qr.download")}
              variant="secondary"
              size="sm"
              className="self-start"
              onPress={() => void download()}
            />
          ) : null}
        </Stack>
      </Row>
      {feedback === "downloadFailed" ? (
        <Banner tone="danger" title={t("zonesTg.qr.downloadFailed")} />
      ) : null}
    </Stack>
  );
}

/**
 * Estado del webhook: siempre el registrado según la plataforma; tras "Verificar", además lo que
 * reporta Telegram (autocorrección, mensajes en cola y último error de entrega).
 */
function WebhookStatus({
  registered,
  status,
}: {
  registered: boolean;
  status: TelegramWebhookStatus | null;
}) {
  const { t } = useT();
  const ok = status ? status.webhookRegistered : registered;
  return (
    <Stack
      gap="xs"
      className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <Text variant="label">
        {t("zonesTg.webhook.label")}:{" "}
        <Text variant="label" tone={ok ? "success" : "danger"}>
          {ok ? t("zonesTg.webhook.pointsHere") : t("zonesTg.webhook.notRegistered")}
        </Text>
      </Text>
      {status?.reRegistered ? (
        <Text variant="caption" tone="muted">
          {t("zonesTg.verify.reRegistered")}
        </Text>
      ) : null}
      {status ? (
        <Text variant="caption" tone="muted">
          {t("zonesTg.verify.pending")}: {status.pendingUpdateCount}
        </Text>
      ) : null}
      {status?.lastErrorMessage ? (
        <Text variant="caption" tone="muted">
          {t("zonesTg.verify.lastError")}: {status.lastErrorMessage}
          {status.lastErrorAt ? ` (${new Date(status.lastErrorAt).toLocaleString()})` : ""}
        </Text>
      ) : null}
      {!status ? (
        <Text variant="caption" tone="muted">
          {t("zonesTg.verify.hint")}
        </Text>
      ) : null}
    </Stack>
  );
}

/** Rotación del token del MISMO bot (tras /revoke en @BotFather); vacío no cambia nada. */
function RotateTokenForm({ botId }: { botId: string }) {
  const { t } = useT();
  const errorText = useErrorText();
  const rotate = useRotateTelegramToken();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  const submit = () => {
    setError(null);
    setRotated(false);
    rotate.mutate(
      { id: botId, botToken: token.trim() },
      {
        onSuccess: () => {
          setRotated(true);
          setToken("");
        },
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  return (
    <Stack gap="sm">
      <Field label={t("zonesTg.rotate.title")} hint={t("zonesTg.rotate.hint")}>
        <Input
          value={token}
          onChangeText={(v) => {
            setToken(v);
            setRotated(false);
          }}
          secureTextEntry
          autoCapitalize="none"
          placeholder={t("zonesTg.rotate.placeholder")}
        />
      </Field>
      {error ? <Banner tone="danger" title={error} /> : null}
      {rotated ? <Banner tone="success" title={t("zonesTg.rotated")} /> : null}
      {token.trim() ? (
        <Button
          label={t("zonesTg.rotate")}
          variant="secondary"
          block
          loading={rotate.isPending}
          onPress={submit}
        />
      ) : null}
    </Stack>
  );
}

/** Alta del bot de la zona: solo el token de @BotFather; el servidor hace el resto. */
function LinkTelegramBotCard({ zoneId }: { zoneId: string }) {
  const { t } = useT();
  const errorText = useErrorText();
  const create = useCreateTelegramChannel();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    create.mutate(
      { zoneId, botToken: token.trim() },
      {
        onSuccess: () => setToken(""),
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  return (
    <Stack gap="sm" className="rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <Text tone="muted">{t("zonesTg.empty")}</Text>
      <Text variant="caption" tone="muted">
        {t("zonesTg.guide")}
      </Text>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Field label={t("zonesTg.token")} hint={t("zonesTg.token.hint")}>
        <Input
          value={token}
          onChangeText={setToken}
          secureTextEntry
          autoCapitalize="none"
          placeholder="123456789:AA…"
        />
      </Field>
      <Button
        label={t("zonesTg.link")}
        block
        disabled={!token.trim()}
        loading={create.isPending}
        onPress={submit}
      />
    </Stack>
  );
}
