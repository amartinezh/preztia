import type { QuoteCreditInput } from "@preztiaos/contracts";
import { Card, MoneyText, Row, Skeleton, Stack, Text, formatDate, formatMoney } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useCreditQuote } from "../api/queries";

/**
 * Vista previa EN VIVO del cronograma antes de desembolsar: "N cuotas de $X", total a pagar,
 * interés y primera/última fecha. Se alimenta de `POST /credits/quote` con los términos que la
 * persona va capturando (`input`; `null` = aún incompletos → no se muestra nada). Nunca bloquea el
 * envío: mientras carga enseña una silueta y, si falla, un aviso discreto.
 */
export function CreditQuoteCard({ input }: { input: QuoteCreditInput | null }) {
  const { t, tf, locale } = useT();
  const quote = useCreditQuote(input);

  if (input === null) return null;

  if (quote.data === undefined) {
    return quote.isError ? (
      <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {t("credit.quote.unavailable")}
      </Text>
    ) : (
      <Card>
        <Stack gap="sm">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </Stack>
      </Card>
    );
  }

  const q = quote.data;
  // La última cuota absorbe el redondeo: solo se menciona cuando difiere de las demás.
  const lastDiffers = q.lastInstallmentMinor !== q.installmentValueMinor;

  return (
    <Card className={quote.isFetching ? "opacity-70" : ""}>
      <Stack gap="sm">
        <Text variant="label" tone="muted">
          {t("credit.quote.title")}
        </Text>
        <Text variant="heading">
          {tf("credit.quote.installmentsOf", {
            n: input.installmentsCount,
            amount: formatMoney(q.installmentValueMinor, q.currency),
          })}
        </Text>
        {lastDiffers ? (
          <Text variant="caption" tone="muted">
            {tf("credit.quote.lastInstallment", { amount: formatMoney(q.lastInstallmentMinor, q.currency) })}
          </Text>
        ) : null}
        <Row className="justify-between">
          <Text tone="muted">{t("credit.quote.total")}</Text>
          <MoneyText variant="label" amountMinor={q.totalDueMinor} currency={q.currency} />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("credit.quote.interest")}</Text>
          <MoneyText variant="label" amountMinor={q.interestMinor} currency={q.currency} />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("credit.quote.firstDue")}</Text>
          <Text variant="label">{formatDate(q.firstDueDate, locale)}</Text>
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("credit.quote.lastDue")}</Text>
          <Text variant="label">{formatDate(q.endDate, locale)}</Text>
        </Row>
      </Stack>
    </Card>
  );
}
