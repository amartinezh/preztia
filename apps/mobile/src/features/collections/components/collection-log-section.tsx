import type { CollectionLogEntry } from "@preztiaos/contracts";
import { Badge, Card, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useCollectionLog } from "../api/visits-queries";

/**
 * Bitácora de VISITAS Y OBSERVACIONES de un crédito, ordenada por fecha (desc). La comparten el
 * cobrador (en el detalle del cobro) y el admin/coordinador (historial del cliente en la ficha del
 * crédito): quién visitó, cuándo, con qué nivel de mora y las observaciones textuales.
 */
export function CollectionLogSection({ creditId }: { creditId: string }) {
  const { t } = useT();
  const log = useCollectionLog(creditId);
  const entries = log.data?.items ?? [];

  return (
    <Stack gap="sm">
      <Text variant="heading">{t("visits.log.title")}</Text>
      {log.isPending ? (
        <Spinner label={t("common.loading")} />
      ) : entries.length === 0 ? (
        <Card>
          <Text tone="muted">{t("visits.log.empty")}</Text>
        </Card>
      ) : (
        entries.map((entry, index) => (
          <LogEntryCard key={`${entry.kind}-${entry.at}-${index}`} entry={entry} />
        ))
      )}
    </Stack>
  );
}

function LogEntryCard({ entry }: { entry: CollectionLogEntry }) {
  const { t } = useT();
  const when = new Date(entry.at).toLocaleString();
  const isVisit = entry.kind === "VISIT";
  return (
    <Card>
      <Stack gap="sm">
        <Row className="items-center justify-between">
          <Badge
            tone={isVisit ? "success" : "info"}
            label={isVisit ? t("visits.visited") : t("visits.observation.label")}
          />
          <Text variant="caption" tone="muted">
            {when}
          </Text>
        </Row>
        <Text>
          {isVisit
            ? t("visits.log.visitMark").replace(
                "{n}",
                String(entry.overdueCountAtVisit ?? 0),
              )
            : entry.body}
        </Text>
        {entry.authorName ? (
          <Text variant="caption" tone="muted">
            {entry.authorName}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}
