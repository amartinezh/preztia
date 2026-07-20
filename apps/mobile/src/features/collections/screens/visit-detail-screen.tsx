import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CollectionLogEntry } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  MoneyText,
  Row,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCreditCollection } from "../api/queries";
import {
  useAddObservation,
  useCollectionLog,
  useMarkVisited,
} from "../api/visits-queries";
import { CollectionLogSection } from "../components/collection-log-section";

/**
 * Detalle del cobro para el COBRADOR: la ficha del crédito (cuota de hoy, teléfono), la bitácora de
 * visitas y observaciones ordenada por fecha, el campo para agregar una observación nueva y el
 * botón "Marcar como visitado" —habilitado solo cuando hay una observación posterior a la última
 * visita—. Desde aquí también se registra el abono.
 */
export function VisitDetailScreen({ creditId }: { creditId: string }) {
  const { t } = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{
    name?: string;
    overdue?: string;
    days?: string;
    outstanding?: string;
    currency?: string;
    phone?: string;
  }>();

  const panel = useCreditCollection(creditId);
  const log = useCollectionLog(creditId);
  const addObs = useAddObservation(creditId);
  const markVisited = useMarkVisited(creditId);

  const [observation, setObservation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);

  const entries = useMemo<CollectionLogEntry[]>(
    () => log.data?.items ?? [],
    [log.data],
  );

  // Observación "nueva" = registrada después de la última visita (o cualquiera si no hay visita).
  // La lista viene ordenada por fecha desc, así que el primer NOTE/VISIT es el más reciente.
  const hasFreshObservation = useMemo(() => {
    const latestNote = entries.find((e) => e.kind === "NOTE");
    const latestVisit = entries.find((e) => e.kind === "VISIT");
    if (!latestNote) return false;
    return !latestVisit || Date.parse(latestNote.at) > Date.parse(latestVisit.at);
  }, [entries]);

  const name = params.name || panel.data?.firstName || creditId.slice(0, 8);
  const currency = params.currency || panel.data?.currency || "COP";

  const translate = (err: unknown) =>
    setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

  const submitObservation = () => {
    setError(null);
    const body = observation.trim();
    if (!body) return;
    addObs.mutate(body, {
      onSuccess: () => setObservation(""),
      onError: translate,
    });
  };

  const submitVisit = () => {
    setError(null);
    markVisited.mutate(undefined, {
      onSuccess: () => {
        setMarked(true);
        router.back();
      },
      onError: translate,
    });
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("visits.detail.title")}</Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {marked ? <Banner tone="success" title={t("visits.marked")} /> : null}

        <Card>
          <Stack gap="sm">
            <Text variant="heading">{name}</Text>
            {params.overdue ? (
              <Text variant="caption" tone="muted">
                {t("visits.overdue")
                  .replace("{n}", params.overdue)
                  .replace("{d}", params.days ?? "0")}
              </Text>
            ) : null}
            {params.outstanding ? (
              <Row className="justify-between">
                <Text tone="muted">{t("visits.outstanding")}</Text>
                <MoneyText
                  variant="label"
                  amountMinor={Number(params.outstanding)}
                  currency={currency}
                />
              </Row>
            ) : null}
            {params.phone ? (
              <Row className="justify-between">
                <Text tone="muted">{t("visits.phone")}</Text>
                <Text variant="label">{params.phone}</Text>
              </Row>
            ) : null}
            <Button
              label={t("visits.registerPayment")}
              variant="secondary"
              block
              onPress={() =>
                router.push({ pathname: "/payment/[creditId]", params: { creditId } })
              }
            />
          </Stack>
        </Card>

        <Card>
          <Stack gap="sm">
            <Field label={t("visits.observation.label")}>
              <Input
                value={observation}
                onChangeText={setObservation}
                placeholder={t("visits.observation.placeholder")}
                multiline
                numberOfLines={3}
                className="min-h-[80px] py-3"
              />
            </Field>
            <Button
              label={t("visits.observation.add")}
              variant="ghost"
              loading={addObs.isPending}
              disabled={observation.trim().length === 0}
              onPress={submitObservation}
            />
            <Button
              label={t("visits.markVisited")}
              block
              loading={markVisited.isPending}
              disabled={!hasFreshObservation}
              onPress={submitVisit}
            />
            {!hasFreshObservation ? (
              <Text variant="caption" tone="muted">
                {t("visits.markVisited.needObservation")}
              </Text>
            ) : null}
          </Stack>
        </Card>

        <CollectionLogSection creditId={creditId} />
      </Stack>
    </Screen>
  );
}
