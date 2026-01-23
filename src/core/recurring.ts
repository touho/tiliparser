import { normalizeKey, roundAmount } from "./normalize";
import type { RecurringFrequency, RecurringGroup, Transaction } from "./model";

export type RecurringOptions = {
  amountTolerance?: number;
  minOccurrences?: number;
  gapToleranceDays?: number;
  minConfidence?: number;
};

const DEFAULT_OPTIONS: Required<RecurringOptions> = {
  amountTolerance: 0.01,
  minOccurrences: 3,
  gapToleranceDays: 3,
  minConfidence: 0.75,
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
  const dated = transactions.filter((tx) => !!tx.date);
  const datasetSorted = [...dated].sort((a, b) => a.date!.getTime() - b.date!.getTime());
  const datasetFirst = datasetSorted[0]?.date ?? null;
  const datasetLast = datasetSorted[datasetSorted.length - 1]?.date ?? null;
  const datasetSpanMonths =
    datasetFirst && datasetLast
      ? (datasetLast.getFullYear() * 12 + datasetLast.getMonth()) -
          (datasetFirst.getFullYear() * 12 + datasetFirst.getMonth()) +
        1
      : 0;
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (!tx.date || !tx.counterparty) continue;
    const key = [
      tx.direction,
      normalizeKey(tx.counterparty),
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

    const monthDates = Array.from(
      new Map(
        sorted.map((tx) => [
          `${tx.date!.getFullYear()}-${tx.date!.getMonth()}`,
          new Date(tx.date!.getFullYear(), tx.date!.getMonth(), 1),
        ])
      ).values()
    ).sort((a, b) => a.getTime() - b.getTime());
    const monthGaps: number[] = [];
    for (let i = 1; i < monthDates.length; i += 1) {
      monthGaps.push(daysBetween(monthDates[i - 1], monthDates[i]));
    }
    const medianMonthGap = monthGaps.length ? median(monthGaps) : null;

    let frequency = classifyFrequency(medianGap, opts.gapToleranceDays);
    let gapsForConfidence = gaps;
    let medianForConfidence = medianGap;

    if (medianMonthGap !== null) {
      const monthFrequency = classifyFrequency(medianMonthGap, opts.gapToleranceDays);
      const isMonthlyCadence =
        monthFrequency === "monthly" || monthFrequency === "quarterly" || monthFrequency === "yearly";
      if (isMonthlyCadence && (medianGap >= 20 || !frequency)) {
        frequency = monthFrequency;
        gapsForConfidence = monthGaps;
        medianForConfidence = medianMonthGap;
      }
    }

    if (!frequency) continue;

    const consistent = gapsForConfidence.filter(
      (gap) => Math.abs(gap - medianForConfidence) <= opts.gapToleranceDays
    );
    const gapConsistency = consistent.length / gapsForConfidence.length;

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
    const medianAmount = median(amounts.map((value) => Math.abs(value)));
    const avgAbsDeviation =
      amounts.reduce((sum, value) => sum + Math.abs(Math.abs(value) - medianAmount), 0) /
      amounts.length;
    const avgAbsDeviationPct =
      medianAmount > 0 ? (avgAbsDeviation / medianAmount) * 100 : 0;

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
    const globalCoveragePct =
      datasetSpanMonths > 0 ? (activeMonths / datasetSpanMonths) * 100 : 0;

    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    const amountScore = (() => {
      if (!avgAbs) return 0;
      const spread = avgAbsDeviationPct;
      if (spread <= 1) return 1;
      if (spread >= 80) return 0;
      return clamp(1 - (spread - 1) / (80 - 1), 0, 1);
    })();

    const dayRange = dayOfMonthMax - dayOfMonthMin;
    const dayScore = (() => {
      if (dayRange <= 3) return 1;
      if (dayRange >= 10) return 0;
      return clamp(1 - (dayRange - 3) / (10 - 3), 0, 1);
    })();

    const timeScore = 0.9 * gapConsistency + 0.1 * dayScore;

    const distributionScore = (() => {
      if (coveragePct >= 90) return 1;
      if (coveragePct <= 40) return 0;
      return clamp((coveragePct - 40) / (90 - 40), 0, 1);
    })();

    const globalDistributionScore = (() => {
      if (globalCoveragePct >= 90) return 1;
      if (globalCoveragePct <= 40) return 0;
      return clamp((globalCoveragePct - 40) / (90 - 40), 0, 1);
    })();

    const confidence =
      sorted.length <= 1
        ? 0
        : clamp(
            0.2 * amountScore +
              0.35 * timeScore +
              0.25 * distributionScore +
              0.2 * globalDistributionScore,
            0,
            1
          );
    if (confidence < opts.minConfidence) continue;

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
