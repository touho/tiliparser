import { normalizeKey, normalizeText } from "./normalize";
import type { Transaction, TransactionDirection } from "./model";

export type CounterpartySummary = {
  counterparty: string;
  direction: TransactionDirection;
  total: number;
  count: number;
};

export function summarizeCounterparties(transactions: Transaction[]): CounterpartySummary[] {
  const map = new Map<string, CounterpartySummary>();

  for (const tx of transactions) {
    const counterparty = normalizeText(tx.counterparty) || "(Unknown)";
    const direction = tx.direction;
    const key = `${direction}|${normalizeKey(counterparty)}`;

    const existing = map.get(key) ?? {
      counterparty,
      direction,
      total: 0,
      count: 0,
    };

    existing.total += tx.amount;
    existing.count += 1;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export function splitSpendIncome(summaries: CounterpartySummary[]) {
  return {
    spend: summaries.filter((s) => s.direction === "out").slice(0, 20),
    income: summaries.filter((s) => s.direction === "in").slice(0, 20),
  };
}

export function summarizeTotals(transactions: Transaction[]) {
  let income = 0;
  let spend = 0;
  for (const tx of transactions) {
    if (tx.amount >= 0) income += tx.amount;
    else spend += tx.amount;
  }
  return { income, spend, net: income + spend };
}
