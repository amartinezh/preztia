import { useState } from "react";
import {
  requiredDocumentType,
  type AssistantAiProvider,
  type DocumentRequirement,
  type RequiredDocumentTypeContract,
} from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Input,
  ListItem,
  Row,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT, type MessageKey } from "@/core/i18n";
import { useZonesList } from "@/features/zones/api/queries";
import {
  useAssistantConfig,
  useCreateChannel,
  useDeleteChannel,
  useDocumentRequirements,
  useSetDocumentRequirements,
  useUpdateAssistantConfig,
  useWhatsappChannels,
} from "../api/queries";

/**
 * Tab WHATSAPP / IA (solo ADMIN): asistente (base de conocimiento + IA), documentos requeridos del
 * crédito y canales (número → zona). Es una sección sensible que el Coordinador no ve (la pestaña
 * ni aparece), por lo que aquí los controles asumen edición.
 */
export function WhatsappTab() {
  return (
    <Stack gap="lg">
      <AssistantConfigCard />
      <DocumentRequirementsCard />
      <WhatsappChannelsCard />
    </Stack>
  );
}

/** Configuración del asistente de WhatsApp: base de conocimiento, proveedor de IA y API key. */
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

type DocDraft = { active: boolean; title: string; description: string };

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

/** Canales de WhatsApp: vincula cada número (phone_number_id) a una zona. */
function WhatsappChannelsCard() {
  const { t } = useT();
  const channels = useWhatsappChannels();
  const zonesQuery = useZonesList();
  const create = useCreateChannel();
  const remove = useDeleteChannel();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const zoneOptions: SelectOption<string>[] = (zonesQuery.data?.items ?? []).map((z) => ({
    value: z.id,
    label: z.name,
    hint: z.path,
  }));

  const submit = () => {
    setError(null);
    if (!phoneNumberId.trim() || !zoneId) {
      setError(t("errors.validation"));
      return;
    }
    create.mutate(
      { phoneNumberId: phoneNumberId.trim(), zoneId },
      {
        onSuccess: () => {
          setPhoneNumberId("");
          setZoneId("");
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("channels.title")}</Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {(channels.data?.items ?? []).map((ch) => (
          <ListItem
            key={ch.id}
            title={ch.phoneNumberId}
            subtitle={ch.zonePath}
            trailing={
              <Row className="items-center gap-2">
                <Badge label={ch.zonePath} tone="info" />
                <Button label={t("common.delete")} variant="ghost" size="sm" onPress={() => remove.mutate(ch.id)} />
              </Row>
            }
          />
        ))}
        {(channels.data?.items ?? []).length === 0 ? (
          <Text tone="muted">{t("channels.empty")}</Text>
        ) : null}
        <Field label={t("channels.phone")}>
          <Input value={phoneNumberId} onChangeText={setPhoneNumberId} />
        </Field>
        <Field label={t("zones.tab")}>
          <Select value={zoneId} options={zoneOptions} onChange={setZoneId} title={t("zones.tab")} />
        </Field>
        <Button label={t("channels.add")} loading={create.isPending} block onPress={submit} />
      </Stack>
    </Card>
  );
}
