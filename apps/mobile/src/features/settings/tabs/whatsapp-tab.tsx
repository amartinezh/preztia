import { useState } from "react";
import {
  requiredDocumentType,
  type AssistantAiProvider,
  type MessagingChannelsSettings,
  type MessagingProviderContract,
  type DocumentRequirement,
  type RequiredDocumentTypeContract,
} from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT, type MessageKey } from "@/core/i18n";
import {
  useAssistantConfig,
  useDocumentRequirements,
  useMessagingChannels,
  useSetDocumentRequirements,
  useUpdateAssistantConfig,
  useUpdateMessagingChannels,
} from "../api/queries";

/**
 * Tab CANALES / IA (solo ADMIN): canales de mensajería habilitados (WhatsApp y/o Telegram), asistente
 * (base de conocimiento + IA) y documentos requeridos del crédito. Es una sección sensible que el
 * Coordinador no ve (la pestaña ni aparece), por lo que aquí los controles asumen edición. El número
 * de WhatsApp o el bot de Telegram de cada zona se configuran en el panel de Zonas.
 */
export function WhatsappTab() {
  return (
    <Stack gap="lg">
      <MessagingChannelsCard />
      <AssistantConfigCard />
      <DocumentRequirementsCard />
    </Stack>
  );
}

/**
 * Proveedores de mensajería del tenant (ADR #40): WhatsApp, Telegram o ambos, y el preferido para
 * los recordatorios de cobranza. Los invariantes (≥ 1 habilitado; preferido habilitado) los valida
 * el servidor; aquí el preferido solo ofrece los proveedores activos para no invitar al error.
 */
function MessagingChannelsCard() {
  const { t } = useT();
  const query = useMessagingChannels();
  const update = useUpdateMessagingChannels();
  const [draft, setDraft] = useState<MessagingChannelsSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;
  const form = draft ?? query.data;

  const set = (patch: Partial<MessagingChannelsSettings>) => {
    const next = { ...form, ...patch };
    // Si se apaga el preferido, se sugiere el otro proveedor para que el guardado sea válido.
    if (next.preferredProactiveChannel === "TELEGRAM" && !next.telegramEnabled) {
      next.preferredProactiveChannel = "WHATSAPP";
    }
    if (next.preferredProactiveChannel === "WHATSAPP" && !next.whatsappEnabled) {
      next.preferredProactiveChannel = "TELEGRAM";
    }
    setDraft(next);
    setSaved(false);
  };

  const preferredOptions: SelectOption<MessagingProviderContract>[] = [
    ...(form.whatsappEnabled ? [{ value: "WHATSAPP" as const, label: t("messaging.whatsapp") }] : []),
    ...(form.telegramEnabled ? [{ value: "TELEGRAM" as const, label: t("messaging.telegram") }] : []),
  ];

  const save = () => {
    setError(null);
    setSaved(false);
    update.mutate(form, {
      onSuccess: () => {
        setSaved(true);
        setDraft(null);
      },
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("messaging.title")}</Text>
        <Text variant="caption" tone="muted">
          {t("messaging.hint")}
        </Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {saved ? <Banner tone="success" title={t("messaging.saved")} /> : null}

        <Switch
          value={form.whatsappEnabled}
          onValueChange={(v) => set({ whatsappEnabled: v })}
          label={t("messaging.whatsapp")}
        />
        <Switch
          value={form.telegramEnabled}
          onValueChange={(v) => set({ telegramEnabled: v })}
          label={t("messaging.telegram")}
        />

        {preferredOptions.length > 1 ? (
          <Field label={t("messaging.preferred")} hint={t("messaging.preferred.hint")}>
            <Select
              value={form.preferredProactiveChannel}
              options={preferredOptions}
              onChange={(v) => set({ preferredProactiveChannel: v })}
              title={t("messaging.preferred")}
            />
          </Field>
        ) : null}

        <Button label={t("messaging.save")} loading={update.isPending} block onPress={save} />
      </Stack>
    </Card>
  );
}

/** Configuración del asistente del chat: base de conocimiento, proveedor de IA y API key. */
function AssistantConfigCard() {
  const { t } = useT();
  const query = useAssistantConfig();
  const update = useUpdateAssistantConfig();
  const [knowledgeBase, setKnowledgeBase] = useState<string | null>(null);
  const [provider, setProvider] = useState<AssistantAiProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;
  const view = query.data;
  const kb = knowledgeBase ?? view.knowledgeBase;
  const prov = provider ?? view.aiProvider;

  const providerOptions: SelectOption<AssistantAiProvider>[] = [
    { value: "GEMINI", label: "Gemini" },
    { value: "OPENAI", label: "OpenAI" },
    { value: "CLAUDE", label: "Claude" },
  ];

  const save = () => {
    setError(null);
    setSaved(false);
    update.mutate(
      {
        knowledgeBase: kb,
        aiProvider: prov,
        ...(apiKey.trim() ? { aiApiKey: apiKey.trim() } : {}),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setApiKey("");
          setKnowledgeBase(null);
          setProvider(null);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("assistant.title")}</Text>
        <Text variant="caption" tone="muted">
          {t("assistant.hint")}
        </Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {saved ? <Banner tone="success" title={t("assistant.saved")} /> : null}

        <Field label={t("assistant.provider")}>
          <Select
            value={prov}
            options={providerOptions}
            onChange={(v) => {
              setProvider(v);
              setSaved(false);
            }}
            title={t("assistant.provider")}
          />
        </Field>

        <Field label={t("assistant.knowledgeBase")}>
          <Input
            multiline
            numberOfLines={6}
            value={kb}
            onChangeText={(text) => {
              setKnowledgeBase(text);
              setSaved(false);
            }}
            placeholder={t("assistant.knowledgeBase.placeholder")}
            className="min-h-[120px] py-3"
            style={{ textAlignVertical: "top" }}
          />
        </Field>

        <Field label={t("assistant.apiKey")}>
          <Input
            value={apiKey}
            onChangeText={(text) => {
              setApiKey(text);
              setSaved(false);
            }}
            secureTextEntry
            autoCapitalize="none"
            placeholder="••••••••"
          />
        </Field>
        <Text variant="caption" tone={view.hasApiKey ? "success" : "muted"}>
          {view.hasApiKey ? t("assistant.apiKey.set") : t("assistant.apiKey.empty")}
        </Text>

        <Button label={t("common.save")} loading={update.isPending} block onPress={save} />
      </Stack>
    </Card>
  );
}

// Etiqueta (i18n) de cada tipo de documento del enum del contrato.
const DOC_TYPE_LABEL: Record<RequiredDocumentTypeContract, MessageKey> = {
  IDENTITY_DOCUMENT: "docs.type.IDENTITY_DOCUMENT",
  BUSINESS_VALIDITY_CERTIFICATE: "docs.type.BUSINESS_VALIDITY_CERTIFICATE",
  BUSINESS_PHOTO: "docs.type.BUSINESS_PHOTO",
  PUBLIC_SERVICES_RECEIPT: "docs.type.PUBLIC_SERVICES_RECEIPT",
  BANK_STATEMENT: "docs.type.BANK_STATEMENT",
  INCOME_PROOF: "docs.type.INCOME_PROOF",
};

type DocDraft = {
  active: boolean;
  title: string;
  description: string;
  /** Archivos que componen el documento: 2 cuando el título pide "ambos lados". */
  expectedFiles: number;
};

/** Tope de archivos por documento; coincide con el máximo que acepta el contrato. */
const MAX_EXPECTED_FILES = 5;

/** Documentos requeridos: define qué pide el bot al iniciar una solicitud. */
function DocumentRequirementsCard() {
  const { t } = useT();
  const query = useDocumentRequirements();
  const save = useSetDocumentRequirements();
  const [drafts, setDrafts] = useState<Record<string, DocDraft> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;

  const byKey = new Map(query.data.items.map((i) => [i.documentKey, i]));
  const current: Record<string, DocDraft> =
    drafts ??
    Object.fromEntries(
      requiredDocumentType.options.map((key) => {
        const row = byKey.get(key);
        return [
          key,
          {
            active: row?.active ?? false,
            title: row?.title ?? "",
            description: row?.description ?? "",
            expectedFiles: row?.expectedFiles ?? 1,
          },
        ];
      }),
    );

  const set = (key: string, patch: Partial<DocDraft>) => {
    setDrafts({ ...current, [key]: { ...current[key]!, ...patch } });
    setSaved(false);
  };

  const activeCount = Object.values(current).filter((d) => d.active).length;

  const submit = () => {
    setError(null);
    setSaved(false);
    const items: DocumentRequirement[] = requiredDocumentType.options
      .filter((key) => current[key]!.active)
      .map((key, order) => ({
        documentKey: key,
        title: current[key]!.title.trim(),
        description: current[key]!.description.trim(),
        sortOrder: order + 1,
        expectedFiles: current[key]!.expectedFiles,
        active: true,
      }));
    if (items.some((i) => !i.title || !i.description)) {
      setError(t("errors.validation"));
      return;
    }
    save.mutate(
      { items },
      {
        onSuccess: () => {
          setSaved(true);
          setDrafts(null);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("docs.title")}</Text>
        <Text variant="caption" tone="muted">
          {t("docs.hint")}
        </Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {saved ? <Banner tone="success" title={t("docs.saved")} /> : null}
        {activeCount === 0 ? <Banner tone="warning" title={t("docs.empty.warning")} /> : null}

        {requiredDocumentType.options.map((key) => {
          const d = current[key]!;
          return (
            <Stack
              key={key}
              gap="xs"
              className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <Switch
                value={d.active}
                onValueChange={(v) => set(key, { active: v })}
                label={t(DOC_TYPE_LABEL[key])}
              />
              {d.active ? (
                <Stack gap="xs">
                  <Field label={t("docs.field.title")}>
                    <Input value={d.title} onChangeText={(text) => set(key, { title: text })} />
                  </Field>
                  <Field label={t("docs.field.description")}>
                    <Input
                      value={d.description}
                      onChangeText={(text) => set(key, { description: text })}
                    />
                  </Field>
                  {/* Si el título pide "ambos lados", aquí se declara que son 2 archivos: el
                      bot no da el documento por completo hasta reunirlos todos. */}
                  <Field label={t("docs.field.expectedFiles")}>
                    <Input
                      value={String(d.expectedFiles)}
                      keyboardType="number-pad"
                      onChangeText={(text) =>
                        set(key, { expectedFiles: clampExpectedFiles(text) })
                      }
                    />
                  </Field>
                </Stack>
              ) : null}
            </Stack>
          );
        })}

        <Button label={t("common.save")} loading={save.isPending} block onPress={submit} />
      </Stack>
    </Card>
  );
}

/** Lee el número de archivos del input, acotado al rango que el contrato admite (1..5). */
function clampExpectedFiles(text: string): number {
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), MAX_EXPECTED_FILES);
}
