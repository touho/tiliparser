import { normalizeKey, roundAmount } from "./normalize";
import type { RecurringFrequency, RecurringGroup, Transaction } from "./model";

export type RecurringOptions = {
  amountTolerance?: number;
  minOccurrences?: number;
  gapToleranceDays?: number;
};

const DEFAULT_OPTIONS: Required<RecurringOptions> = {
  amountTolerance: 0.01,
  minOccurrences: 3,
  gapToleranceDays: 3,
};

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifyFrequency(medianGap: number, tolerance: number): RecurringFrequency | null {
  const within = (target: number) => Math.abs(medianGap - target) <= tolerance;
  if (within(7)) return "weekly";
  if (within(14)) return "biweekly";
  if (medianGap >= 26 && medianGap <= 33) return "monthly";
  if (within(91) || within(90)) return "quarterly";
  if (medianGap >= 350 && medianGap <= 380) return "yearly";
  return null;
}

export function detectRecurring(
  transactions: Transaction[],
  options: RecurringOptions = {}
): RecurringGroup[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (!tx.date || !tx.counterparty) continue;
    const key = [
      tx.direction,
      normalizeKey(tx.counterparty),
      roundAmount(tx.amount, opts.amountTolerance).toFixed(2),
      tx.currency ?? "",
    ].join("|");

    const bucket = groups.get(key) ?? [];
    bucket.push(tx);
    groups.set(key, bucket);
  }

  const result: RecurringGroup[] = [];

  for (const [key, items] of groups.entries()) {
    if (items.length < opts.minOccurrences) continue;
    const sorted = [...items].sort((a, b) => a.date!.getTime() - b.date!.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push(daysBetween(sorted[i - 1].date!, sorted[i].date!));
    }
    if (!gaps.length) continue;

    const medianGap = median(gaps);
    const frequency = classifyFrequency(medianGap, opts.gapToleranceDays);
    if (!frequency) continue;

    const consistent = gaps.filter((gap) => Math.abs(gap - medianGap) <= opts.gapToleranceDays);
    const confidence = consistent.length / gaps.length;
    if (confidence < 0.6) continue;

    const amount = sorted[0].amount;
    const firstDate = sorted[0].date!;
    const lastDate = sorted[sorted.length - 1].date!;
    const nextExpected = new Date(lastDate.getTime());
    nextExpected.setDate(nextExpected.getDate() + Math.round(medianGap));

    const amounts = sorted.map((tx) => tx.amount);
    const amountMin = Math.min(...amounts);
    const amountMax = Math.max(...amounts);
    const avgAbs =
      amounts.reduce((sum, value) => sum + Math.abs(value), 0) / amounts.length;
    const amountSpreadPct =
      avgAbs > 0 ? ((amountMax - amountMin) / avgAbs) * 100 : 0;

    const days = sorted.map((tx) => tx.date!.getDate());
    const dayOfMonthMin = Math.min(...days);
    const dayOfMonthMax = Math.max(...days);

    const monthKeys = new Set(
      sorted.map((tx) => `${tx.date!.getFullYear()}-${tx.date!.getMonth()}`)
    );
    const activeMonths = monthKeys.size;
    const spanMonths =
      (lastDate.getFullYear() * 12 + lastDate.getMonth()) -
      (firstDate.getFullYear() * 12 + firstDate.getMonth()) +
      1;
    const coveragePct = spanMonths > 0 ? (activeMonths / spanMonths) * 100 : 0;

    result.push({
      key,
      direction: sorted[0].direction,
      counterparty: sorted[0].counterparty!,
      amount,
      currency: sorted[0].currency ?? null,
      occurrences: sorted.length,
      dates: sorted.map((tx) => tx.date!),
      firstDate,
      lastDate,
      amountMin,
      amountMax,
      amountSpreadPct: Number(amountSpreadPct.toFixed(2)),
      dayOfMonthMin,
      dayOfMonthMax,
      monthKeys: Array.from(monthKeys),
      activeMonths,
      spanMonths,
      coveragePct: Number(coveragePct.toFixed(2)),
      avgGapDays: medianGap,
      frequency,
      confidence: Number(confidence.toFixed(2)),
      totalAmount: sorted.reduce((sum, tx) => sum + tx.amount, 0),
      nextExpected,
    });
  }

  return result.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return Math.abs(b.totalAmount) - Math.abs(a.totalAmount);
  });
}
