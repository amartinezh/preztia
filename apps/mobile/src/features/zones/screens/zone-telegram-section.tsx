import { useState } from "react";
import { Linking } from "react-native";
import type { TelegramChannel, TelegramWebhookStatus, ZoneNode } from "@preztiaos/contracts";
import { Badge, Banner, Button, Field, Input, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCreateTelegramChannel,
  useDeleteTelegramChannel,
  useRotateTelegramToken,
  useTelegramChannels,
  useVerifyTelegramChannel,
} from "@/features/settings/api/queries";

const CARD = "rounded-xl border border-zinc-200 p-3 dark:border-zinc-800";

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

/** Bot vinculado: estado del webhook, verificación, rotación del token y desvinculación. */
function TelegramBotCard({ bot }: { bot: TelegramChannel }) {
  const { t } = useT();
  const errorText = useErrorText();
  const verify = useVerifyTelegramChannel();
  const rotate = useRotateTelegramToken();
  const remove = useDeleteTelegramChannel();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const onError = (err: unknown) => setError(errorText(err));
  const submitRotation = () => {
    setError(null);
    setRotated(false);
    rotate.mutate(
      { id: bot.id, botToken: token.trim() },
      {
        onSuccess: () => {
          setRotated(true);
          setToken("");
        },
        onError,
      },
    );
  };

  return (
    <Stack gap="sm" className={CARD}>
      <Row className="items-center justify-between">
        <Text variant="subtitle">{bot.botUsername ? `@${bot.botUsername}` : bot.channelId}</Text>
        <Badge
          label={bot.webhookRegistered ? t("zonesTg.webhook.ok") : t("zonesTg.webhook.missing")}
          tone={bot.webhookRegistered ? "success" : "warning"}
        />
      </Row>
      {bot.botUsername ? (
        <Button
          label={`t.me/${bot.botUsername}`}
          variant="ghost"
          size="sm"
          onPress={() => void Linking.openURL(`https://t.me/${bot.botUsername}`)}
        />
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}

      <Button
        label={t("zonesTg.verify")}
        variant="secondary"
        block
        loading={verify.isPending}
        onPress={() => {
          setError(null);
          verify.mutate(bot.id, { onError });
        }}
      />
      {verify.data ? <WebhookStatus status={verify.data} /> : null}

      <Field label={t("zonesTg.rotate")} hint={t("zonesTg.rotate.hint")}>
        <Input
          value={token}
          onChangeText={(v) => {
            setToken(v);
            setRotated(false);
          }}
          secureTextEntry
          autoCapitalize="none"
          placeholder="123456789:AA…"
        />
      </Field>
      {rotated ? <Banner tone="success" title={t("zonesTg.rotated")} /> : null}
      <Button
        label={t("zonesTg.rotate")}
        variant="secondary"
        block
        disabled={!token.trim()}
        loading={rotate.isPending}
        onPress={submitRotation}
      />

      {confirmUnlink ? (
        <Banner tone="warning" title={t("zonesTg.unlink.confirm")} />
      ) : null}
      <Button
        label={t("zonesTg.unlink")}
        variant={confirmUnlink ? "danger" : "ghost"}
        block
        loading={remove.isPending}
        onPress={() => {
          if (!confirmUnlink) {
            setConfirmUnlink(true);
            return;
          }
          remove.mutate(bot.id, { onError });
        }}
      />
    </Stack>
  );
}

/** Diagnóstico devuelto por "Verificar": autocorrección, cola en Telegram y último error. */
function WebhookStatus({ status }: { status: TelegramWebhookStatus }) {
  const { t } = useT();
  return (
    <Stack gap="xs">
      <Banner
        tone={status.webhookRegistered ? "success" : "danger"}
        title={status.reRegistered ? t("zonesTg.verify.reRegistered") : t("zonesTg.verify.ok")}
      />
      <Text variant="caption" tone="muted">
        {t("zonesTg.verify.pending")}: {status.pendingUpdateCount}
      </Text>
      {status.lastErrorMessage ? (
        <Text variant="caption" tone="muted">
          {t("zonesTg.verify.lastError")}: {status.lastErrorMessage}
          {status.lastErrorAt ? ` (${new Date(status.lastErrorAt).toLocaleString()})` : ""}
        </Text>
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
