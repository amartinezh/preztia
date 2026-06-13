import { useMemo } from "react";
import type { BadgeTone } from "@preztiaos/ui";
import type { PaymentSummary } from "@preztiaos/contracts";
import { Badge, Button, Card, EmptyState, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { usePaymentsList } from "../api/queries";

function paymentBadge(status: PaymentSummary["status"]): { tone: BadgeTone; label: string } {
  switch (status) {
    case "VERIFIED":
      return { tone: "success", label: "Verificado" };
    case "RECEIVED":
      return { tone: "info", label: "Recibido" };
    case "UNVERIFIED":
      return { tone: "warning", label: "Sin verificar" };
    case "REJECTED_FRAUD":
      return { tone: "danger", label: "Fraude" };
    case "REJECTED_INVALID":
      return { tone: "danger", label: "Inválido" };
  }
}

/**
 * Lista de pagos de un crédito. Muestra SOLO los campos que el contrato expone (con CPF/CNPJ
 * ya enmascarado); la PII completa nunca sale de la BD bajo RLS. Sin FlatList para evitar
 * virtualización anidada dentro del ScrollView de la pantalla de cartera.
 */
export function PaymentsList({ creditId }: { creditId: string }) {
  const { t } = useT();
  const query = usePaymentsList(creditId);

  const items = useMemo<PaymentSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner />;
  if (query.isError) return <Text tone="danger">{t("errors.network")}</Text>;
  if (items.length === 0) return <EmptyState title={t("payments.empty")} />;

  return (
    <Stack gap="sm">
      {items.map((p) => {
        const badge = paymentBadge(p.status);
        return (
          <Card key={p.id}>
            <Row className="justify-between">
              <Stack gap="xs">
                <Text variant="label">{p.payerName ?? "—"}</Text>
                <Text variant="caption" tone="muted">
                  {p.payerTaxIdMasked ?? p.payerBankName ?? p.endToEndId ?? p.id.slice(0, 8)}
                </Text>
              </Stack>
              <Stack gap="xs" className="items-end">
                {p.amountMinor !== null ? (
                  <MoneyText variant="label" amountMinor={p.amountMinor} currency={p.currency} />
                ) : (
                  <Text variant="label" tone="muted">—</Text>
                )}
                <Badge tone={badge.tone} label={badge.label} />
              </Stack>
            </Row>
          </Card>
        );
      })}
      {query.hasNextPage ? (
        <Button
          label="Cargar más"
          variant="secondary"
          size="sm"
          loading={query.isFetchingNextPage}
          onPress={() => query.fetchNextPage()}
        />
      ) : null}
    </Stack>
  );
}
