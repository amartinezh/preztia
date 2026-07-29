import type {
  ConversationOrder,
  ConversationSort,
} from "@preztiaos/contracts";
import { Button, Field, Input, Row, Select, Stack, Switch, type SelectOption } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useZonesList } from "@/features/zones/api/queries";

/** Estado de filtros tal como lo edita la pantalla (cadenas del formulario, sin normalizar). */
export type FiltersDraft = {
  search: string;
  from: string;
  to: string;
  zonePath: string;
  channelId: string;
  withApplication: boolean;
};

export const EMPTY_DRAFT: FiltersDraft = {
  search: "",
  from: "",
  to: "",
  zonePath: "",
  channelId: "",
  withApplication: false,
};

const SORTS: readonly ConversationSort[] = [
  "lastAt",
  "firstAt",
  "messageCount",
  "failures",
  "phone",
];

type Props = {
  draft: FiltersDraft;
  onChange: (draft: FiltersDraft) => void;
  sort: ConversationSort;
  order: ConversationOrder;
  onSortChange: (sort: ConversationSort) => void;
  onOrderChange: (order: ConversationOrder) => void;
};

/**
 * Controles de consulta de la bandeja: texto libre, rango de fechas, zona, canal y orden.
 * Presentacional: no consulta el listado ni conoce el read model; solo edita el criterio.
 */
export function ConversationFiltersPanel({
  draft,
  onChange,
  sort,
  order,
  onSortChange,
  onOrderChange,
}: Props) {
  const { t } = useT();
  const zones = useZonesList();

  const patch = (partial: Partial<FiltersDraft>) => onChange({ ...draft, ...partial });

  const zoneOptions: SelectOption<string>[] = [
    { value: "", label: t("inbox.filters.allZones") },
    ...(zones.data?.items ?? []).map((z) => ({
      value: z.path,
      label: z.name,
      hint: z.path,
    })),
  ];
  const sortOptions: SelectOption<ConversationSort>[] = SORTS.map((value) => ({
    value,
    label: t(`inbox.sort.${value}`),
  }));
  const orderOptions: SelectOption<ConversationOrder>[] = [
    { value: "desc", label: t("inbox.sort.desc") },
    { value: "asc", label: t("inbox.sort.asc") },
  ];

  return (
    <Stack gap="sm">
      <Input
        value={draft.search}
        onChangeText={(search) => patch({ search })}
        placeholder={t("inbox.search")}
        autoCapitalize="none"
      />

      <Row gap="sm">
        <Stack className="flex-1">
          <Field label={t("inbox.filters.from")}>
            <Input
              value={draft.from}
              onChangeText={(from) => patch({ from })}
              placeholder={t("inbox.filters.datePlaceholder")}
              autoCapitalize="none"
            />
          </Field>
        </Stack>
        <Stack className="flex-1">
          <Field label={t("inbox.filters.to")}>
            <Input
              value={draft.to}
              onChangeText={(to) => patch({ to })}
              placeholder={t("inbox.filters.datePlaceholder")}
              autoCapitalize="none"
            />
          </Field>
        </Stack>
      </Row>

      <Field label={t("inbox.filters.zone")}>
        <Select
          value={draft.zonePath}
          options={zoneOptions}
          onChange={(zonePath) => patch({ zonePath })}
        />
      </Field>

      <Field label={t("inbox.filters.channel")}>
        <Input
          value={draft.channelId}
          onChangeText={(channelId) => patch({ channelId })}
          placeholder={t("inbox.filters.channel")}
          autoCapitalize="none"
        />
      </Field>

      <Row gap="sm">
        <Stack className="flex-1">
          <Field label={t("inbox.sort.label")}>
            <Select value={sort} options={sortOptions} onChange={onSortChange} />
          </Field>
        </Stack>
        <Stack className="flex-1">
          <Field label=" ">
            <Select value={order} options={orderOptions} onChange={onOrderChange} />
          </Field>
        </Stack>
      </Row>

      <Switch
        value={draft.withApplication}
        onValueChange={(withApplication) => patch({ withApplication })}
        label={t("inbox.withApplication")}
      />

      <Button
        label={t("inbox.filters.clear")}
        variant="ghost"
        size="sm"
        onPress={() => onChange(EMPTY_DRAFT)}
      />
    </Stack>
  );
}
