// Money formats a numeric(14,2) string-money value with currency. Schema
// stores `amount` as a Postgres numeric (decimal as string) and `currency`
// as ISO 4217 — Money expects both. Never accepts Number to avoid float
// precision loss.

export type MoneyProps = {
  amount: string;
  currency: string;
  className?: string;
};

export function Money({ amount, currency, className }: MoneyProps) {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return <span className={className}>—</span>;
  }
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return <span className={className}>{formatted}</span>;
}
