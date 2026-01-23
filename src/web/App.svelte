<script lang="ts">
  import { onMount } from "svelte";
  import { Chart } from "svelte-echarts";
  import * as echarts from "echarts";
  import type { EChartsOption } from "echarts";
  import { Grid } from "@svar-ui/svelte-grid";
  import { Willow } from "@svar-ui/svelte-core";
  import { parseTransactions } from "../parsers";
  import { detectRecurring } from "../core/recurring";
  import { splitSpendIncome, summarizeCounterparties, summarizeTotals } from "../core/analysis";
  import { normalizeKey, roundAmount } from "../core/normalize";
  import type { Transaction, RecurringGroup } from "../core/model";

  let bank: "nordea" = "nordea";
  let fileName = "";
  let warnings: string[] = [];
  let transactions: Transaction[] = [];
  let recurring: RecurringGroup[] = [];
  let recurringConfidence = 0.6;
  let totals = { income: 0, spend: 0, net: 0 };
  let spend: Array<{ counterparty: string; total: number; count: number }> = [];
  let income: Array<{ counterparty: string; total: number; count: number }> = [];
  let loadError = "";
  let sampleFiles: string[] = [];
  let selectedSample = "";
  let sampleError = "";
  let sampleAvailable = false;
  const sampleStorageKey = "tiliparser.lastSample";
  let filterSearch = "";
  let filterDirection: "all" | "in" | "out" = "all";
  let filterMinAmount = "";
  let filterMaxAmount = "";
  let filterRecurringFilter: "all" | "recurring" | "non-recurring" = "all";
  let selectedRecurringKey: string | null = null;
  let hiddenRecurringKeys = new Set<string>();
  let hiddenTransactionGroups = new Set<string>();
  let selectedTransactionSeriesName = "";
  const topN = 10;
  let recurringChartOptions: EChartsOption | null = null;
  let transactionsChartOptions: EChartsOption | null = null;

  const transactionColumns = [
    { id: "date", header: { text: "Date" }, width: 110, sort: true },
    { id: "amount", header: { text: "Amount" }, width: 110, sort: true },
    { id: "direction", header: { text: "Dir" }, width: 70, sort: true },
    { id: "counterparty", header: { text: "Counterparty" }, width: 220, sort: true },
    { id: "title", header: { text: "Title" }, width: 220, sort: true },
    { id: "message", header: { text: "Message" }, width: 220, sort: true },
    { id: "reference", header: { text: "Reference" }, width: 150, sort: true },
  ];

  const recurringColumns = [
    { id: "counterparty", header: "Counterparty", width: 220 },
    { id: "frequency", header: "Frequency", width: 110 },
    { id: "occurrences", header: "Count", width: 80 },
    { id: "amount", header: "Amount", width: 110 },
    { id: "amountVar", header: "Amount var", width: 120 },
    { id: "dayOfMonth", header: "Day", width: 90 },
    { id: "coverage", header: "Coverage", width: 120 },
    { id: "confidence", header: "Conf.", width: 90 },
    { id: "lastDate", header: "Last", width: 120 },
    { id: "nextExpected", header: "Next", width: 120 },
  ];


  function formatDate(date: Date | null, fallback: string) {
    return date ? date.toISOString().slice(0, 10) : fallback;
  }

  $: recurringKeySet = new Set(
    recurring.map((group) => group.key)
  );

  function getRecurringKey(tx: Transaction) {
    return [
      tx.direction,
      normalizeKey(tx.counterparty ?? ""),
      tx.currency ?? "",
    ].join("|");
  }

  $: filteredTransactions = (() => {
    const direction = filterDirection;
    const min = filterMinAmount ? Number(filterMinAmount) : null;
    const max = filterMaxAmount ? Number(filterMaxAmount) : null;
    const recurringFilter = filterRecurringFilter;
    const needle = filterSearch.trim().toLowerCase();
    const keySet = recurringKeySet;

    return transactions.filter((tx) => {
      if (direction !== "all" && tx.direction !== direction) return false;
      if (min !== null && !Number.isNaN(min) && Math.abs(tx.amount) < min) return false;
      if (max !== null && !Number.isNaN(max) && Math.abs(tx.amount) > max) return false;
      if (recurringFilter === "recurring" && !keySet.has(getRecurringKey(tx))) return false;
      if (recurringFilter === "non-recurring" && keySet.has(getRecurringKey(tx))) return false;
      if (needle) {
        const hay = [
          tx.counterparty,
          tx.title,
          tx.message,
          tx.reference,
          tx.name,
          tx.payer,
          tx.payee,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  })();

  $: transactionRows = filteredTransactions.map((tx, idx) => ({
    id: `${tx.id}-${idx}`,
    date: formatDate(tx.date, tx.rawDate),
    amount: tx.amount.toFixed(2),
    direction: tx.direction,
    counterparty: tx.counterparty ?? "",
    title: tx.title ?? "",
    message: tx.message ?? "",
    reference: tx.reference ?? "",
  }));

  $: latestDate = transactions.reduce<Date | null>((max, tx) => {
    if (!tx.date) return max;
    if (!max) return tx.date;
    return tx.date > max ? tx.date : max;
  }, null);


  function formatAmountVar(group: RecurringGroup) {
    const spread = group.amountMax - group.amountMin;
    if (Math.abs(spread) < 0.01) return "Exact";
    return `±${(spread / 2).toFixed(2)} (${group.amountSpreadPct.toFixed(1)}%)`;
  }

  function formatDaySpread(group: RecurringGroup) {
    if (group.dayOfMonthMin === group.dayOfMonthMax) return `Day ${group.dayOfMonthMin}`;
    return `Day ${group.dayOfMonthMin}-${group.dayOfMonthMax}`;
  }

  function formatCoverage(group: RecurringGroup) {
    return `${group.activeMonths}/${group.spanMonths} (${group.coveragePct.toFixed(0)}%)`;
  }

  function isActiveRecently(group: RecurringGroup) {
    if (!latestDate) return false;
    const diffDays = Math.round(
      (latestDate.getTime() - group.lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return diffDays <= 62;
  }

  $: recurringRows = recurring.map((group) => ({
    id: group.key,
    counterparty: group.counterparty,
    frequency: group.frequency,
    occurrences: group.occurrences,
    amount: group.amount.toFixed(2),
    amountVar: formatAmountVar(group),
    dayOfMonth: formatDaySpread(group),
    coverage: formatCoverage(group),
    confidence: group.confidence,
    lastDate: group.lastDate.toISOString().slice(0, 10),
    nextExpected: group.nextExpected.toISOString().slice(0, 10),
  }));

  function selectRecurringByKey(key: string | null) {
    selectedRecurringKey = key;
  }

  function setRecurringVisibility(key: string, visible: boolean) {
    const next = new Set(hiddenRecurringKeys);
    if (visible) {
      next.delete(key);
    } else {
      next.add(key);
    }
    hiddenRecurringKeys = next;
  }

  function toggleRecurringVisibilityByKey(key: string) {
    const isVisible = !hiddenRecurringKeys.has(key);
    setRecurringVisibility(key, !isVisible);
  }

  function toggleTransactionVisibilityByName(name: string) {
    const next = new Set(hiddenTransactionGroups);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    hiddenTransactionGroups = next;
  }

  $: selectedRecurring = recurring.find((group) => group.key === selectedRecurringKey) ?? null;

  $: selectedRecurringTxs = selectedRecurring
    ? transactions
        .filter((tx) => getRecurringKey(tx) === selectedRecurring.key)
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    : [];

  $: chartRecurring = [...recurring]
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))
    .slice(0, 20);
  $: legendSelected = Object.fromEntries(
    chartRecurring.map((group) => [group.counterparty, !hiddenRecurringKeys.has(group.key)])
  );

  function toIsoDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  function buildMonthAxis(recurringGroups: RecurringGroup[], txs: Transaction[]): string[] {
    const allRecurringDates = recurringGroups.flatMap((group) => group.dates);
    if (allRecurringDates.length) {
      const minDate = new Date(Math.min(...allRecurringDates.map((d) => d.getTime())));
      const maxDate = new Date(Math.max(...allRecurringDates.map((d) => d.getTime())));
      const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
      const axis: string[] = [];
      while (cursor <= end) {
        axis.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return axis;
    }

    const allDates = txs.map((tx) => tx.date).filter((d): d is Date => !!d);
    if (!allDates.length) return [];
    const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
    const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    const axis: string[] = [];
    while (cursor <= end) {
      axis.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return axis;
  }

  function sumByMonth(group: RecurringGroup, axis: string[], txs: Transaction[]): number[] {
    const sums = new Map<string, number>();
    txs
      .filter((tx) => getRecurringKey(tx) === group.key)
      .forEach((tx) => {
        if (!tx.date) return;
        const key = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
        sums.set(key, (sums.get(key) ?? 0) + tx.amount);
      });
    const seriesSign = group.totalAmount < 0 ? -1 : 1;
    return axis.map((key) => {
      const value = sums.get(key) ?? 0;
      return Math.abs(value) < 0.01 ? seriesSign * 0.0001 : value;
    });
  }

  function gradient(from: string, to: string) {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ]);
  }

  $: monthAxis = buildMonthAxis(recurring, transactions);

  const baseHues = [140, 195, 210, 320, 45, 270, 5, 90];

  function seriesColor(idx: number) {
    const hue = baseHues[idx % baseHues.length];
    const shift = Math.floor(idx / baseHues.length) * 17;
    const value = (hue + shift) % 360;
    return `hsl(${value}, 85%, 55%)`;
  }

  function seriesGradient(idx: number) {
    const hue = baseHues[idx % baseHues.length];
    const shift = Math.floor(idx / baseHues.length) * 17;
    const base = (hue + shift) % 360;
    const top = `hsl(${base}, 85%, 70%)`;
    const bottom = `hsl(${(base + 18) % 360}, 85%, 42%)`;
    return gradient(top, bottom);
  }

  function buildAxisFromTransactions(txs: Transaction[]): string[] {
    const allDates = txs.map((tx) => tx.date).filter((d): d is Date => !!d);
    if (!allDates.length) return [];
    const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
    const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    const axis: string[] = [];
    while (cursor <= end) {
      axis.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return axis;
  }

  function buildTransactionsSeries(txs: Transaction[], axis: string[]) {
    const groups = new Map<
      string,
      { name: string; total: number; monthly: Map<string, number> }
    >();

    txs.forEach((tx) => {
      if (!tx.date) return;
      const name = tx.counterparty ?? "(Unknown)";
      const key = normalizeKey(name) || "(unknown)";
      const monthKey = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
      const entry =
        groups.get(key) ?? { name, total: 0, monthly: new Map<string, number>() };
      entry.total += tx.amount;
      entry.monthly.set(monthKey, (entry.monthly.get(monthKey) ?? 0) + tx.amount);
      groups.set(key, entry);
    });

    const sorted = [...groups.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const top = sorted.slice(0, 8);
    const rest = sorted.slice(8);

    const series = top.map((group, idx) => {
      const sign = group.total < 0 ? -1 : 1;
      return {
        id: group.name,
        name: group.name,
        type: "line" as const,
        stack: "total",
        smooth: true,
        showSymbol: false,
        triggerLineEvent: true,
        lineStyle: { width: 0 },
        itemStyle: { color: seriesColor(idx) },
        areaStyle: {
          opacity: 0.9,
          color: seriesGradient(idx),
        },
        emphasis: { focus: "series" },
        data: axis.map((key) => {
          const value = group.monthly.get(key) ?? 0;
          return Math.abs(value) < 0.01 ? sign * 0.0001 : value;
        }),
      };
    });

    if (rest.length) {
      const monthly = new Map<string, number>();
      let total = 0;
      rest.forEach((group) => {
        total += group.total;
        group.monthly.forEach((value, key) => {
          monthly.set(key, (monthly.get(key) ?? 0) + value);
        });
      });
      const sign = total < 0 ? -1 : 1;
      series.push({
        id: "Other",
        name: "Other",
        type: "line" as const,
        stack: "total",
        smooth: true,
        showSymbol: false,
        triggerLineEvent: true,
        lineStyle: { width: 0 },
        itemStyle: { color: seriesColor(9) },
        areaStyle: {
          opacity: 0.9,
          color: seriesGradient(9),
        },
        emphasis: { focus: "series" },
        data: axis.map((key) => {
          const value = monthly.get(key) ?? 0;
          return Math.abs(value) < 0.01 ? sign * 0.0001 : value;
        }),
      });
    }

    return series;
  }

  $: recurringChartOptions = recurring.length && monthAxis.length
    ? {
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "cross",
            label: { backgroundColor: "#6a7985" },
          },
          formatter: (params: unknown) => {
            if (!Array.isArray(params)) return "";
            const rows = params
              .filter((item) => item && typeof item === "object")
              .map((item) => {
                const dataItem = item as {
                  seriesName?: string;
                  marker?: string;
                  value?: number | string;
                };
                const label = dataItem.seriesName ?? "Unknown";
                const value =
                  typeof dataItem.value === "number"
                    ? dataItem.value.toFixed(2)
                    : dataItem.value ?? "";
                return `${dataItem.marker ?? ""} ${label}: ${value}`;
              });
            return rows.join("<br/>");
          },
        },
        legend: {
          type: "scroll",
          top: 0,
          textStyle: { color: "#5b5f66" },
          selected: legendSelected,
        },
        grid: {
          left: 40,
          right: 20,
          top: 40,
          bottom: 30,
        },
        xAxis: {
          type: "category" as const,
          data: monthAxis,
          boundaryGap: false,
        },
        yAxis: {
          type: "value" as const,
        },
        series: chartRecurring.map((group, idx) => ({
          id: group.key,
          name: group.counterparty,
          type: "line" as const,
          stack: "total",
          smooth: true,
          showSymbol: false,
          triggerLineEvent: true,
          lineStyle: { width: 0 },
          itemStyle: { color: seriesColor(idx) },
          areaStyle: {
            opacity: 0.9,
            color: seriesGradient(idx),
          },
          emphasis: { focus: "series" },
          data: sumByMonth(group, monthAxis, transactions),
        })),
      }
    : null;

  $: transactionsAxis = buildAxisFromTransactions(filteredTransactions);
  $: transactionsSeries = buildTransactionsSeries(filteredTransactions, transactionsAxis);
  $: transactionsLegendSelected = Object.fromEntries(
    transactionsSeries.map((series) => [series.name, !hiddenTransactionGroups.has(series.name)])
  );
  $: transactionsChartOptions =
    transactionsAxis.length && transactionsSeries.length
      ? {
          tooltip: {
            trigger: "axis",
            axisPointer: {
              type: "cross",
              label: { backgroundColor: "#6a7985" },
            },
            formatter: (params: unknown) => {
              if (!Array.isArray(params)) return "";
              const rows = params
                .filter((item) => item && typeof item === "object")
                .map((item) => {
                  const dataItem = item as {
                    seriesName?: string;
                    marker?: string;
                    value?: number | string;
                  };
                  const label = dataItem.seriesName ?? "Unknown";
                  const value =
                    typeof dataItem.value === "number"
                      ? dataItem.value.toFixed(2)
                      : dataItem.value ?? "";
                  return `${dataItem.marker ?? ""} ${label}: ${value}`;
                });
              return rows.join("<br/>");
            },
          },
          legend: {
            type: "scroll",
            top: 0,
            textStyle: { color: "#5b5f66" },
            selected: transactionsLegendSelected,
          },
          grid: {
            left: 40,
            right: 20,
            top: 40,
            bottom: 30,
          },
          xAxis: {
            type: "category" as const,
            data: transactionsAxis,
            boundaryGap: false,
          },
          yAxis: {
            type: "value" as const,
          },
          series: transactionsSeries,
        }
      : null;

  $: topRecurring = [...recurring]
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))
    .slice(0, topN);

  $: oneOffBigSpends = transactions
    .filter((tx) => tx.direction === "out" && !recurringKeySet.has(getRecurringKey(tx)))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, topN);

  $: if (transactions.length) {
    recurring = detectRecurring(transactions, { minConfidence: recurringConfidence });
  }

  async function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    fileName = file.name;
    loadError = "";
    const text = await file.text();
    const parsed = parseTransactions(bank, text);

    transactions = parsed.transactions;
    warnings = parsed.warnings;

    totals = summarizeTotals(transactions);
    const summaries = summarizeCounterparties(transactions);
    const split = splitSpendIncome(summaries);
    spend = split.spend;
    income = split.income;

    recurring = detectRecurring(transactions, { minConfidence: recurringConfidence });
  }


  async function loadSample() {
    if (!selectedSample) return;
    loadError = "";
    try {
      const response = await fetch(`/__samples/${encodeURIComponent(selectedSample)}`);
      if (!response.ok) {
        throw new Error(`Failed to load (${response.status})`);
      }
      const text = await response.text();
      fileName = selectedSample;
      const parsed = parseTransactions(bank, text);

      transactions = parsed.transactions;
      warnings = parsed.warnings;

      totals = summarizeTotals(transactions);
      const summaries = summarizeCounterparties(transactions);
      const split = splitSpendIncome(summaries);
      spend = split.spend;
      income = split.income;

      recurring = detectRecurring(transactions, { minConfidence: recurringConfidence });
      localStorage.setItem(sampleStorageKey, selectedSample);
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Failed to load sample";
    }
  }

  async function refreshSamples() {
    sampleError = "";
    try {
      const response = await fetch("/__samples/");
      if (!response.ok) {
        sampleAvailable = false;
        sampleError = `Failed to load samples (${response.status})`;
        return;
      }
      const files = (await response.json()) as string[];
      sampleAvailable = true;
      sampleFiles = files;
      const last = localStorage.getItem(sampleStorageKey);
      if (last && files.includes(last)) {
        selectedSample = last;
      } else if (!selectedSample && files.length) {
        selectedSample = files[0];
      }
      if (!files.length) {
        sampleError = "No CSV files found in /samples";
      }
    } catch {
      sampleAvailable = false;
      sampleError = "Sample endpoint not available (dev server only)";
    }
  }

  onMount(refreshSamples);
</script>

<Willow>
  <main class="app">
    <header class="hero">
      <div>
        <p class="eyebrow">tiliparser v2</p>
        <p class="sub">Upload Nordea CSV to explore transactions, recurring payments, and top counterparties.</p>
        <p class="privacy-note">
          All parsing happens locally in your browser. No data leaves your device, and there is no database.
        </p>
      </div>
      <div class="uploader">
        <label>
          <span>Bank</span>
          <select bind:value={bank}>
            <option value="nordea">Nordea</option>
          </select>
        </label>
        {#if sampleAvailable}
          <label>
            <span>Load sample (dev only)</span>
            <div class="server-load">
              <select bind:value={selectedSample} disabled={!sampleFiles.length}>
                {#if !sampleFiles.length}
                  <option value="">No samples found</option>
                {:else}
                  {#each sampleFiles as sample}
                    <option value={sample}>{sample}</option>
                  {/each}
                {/if}
              </select>
              <button on:click={loadSample} disabled={!selectedSample}>Load</button>
            </div>
            {#if sampleError}
              <small class="helper">{sampleError}</small>
            {/if}
          </label>
        {/if}
        <label class="file">
          <span>{fileName || "Choose CSV"}</span>
          <input type="file" accept=".csv,.txt" on:change={handleFileChange} />
        </label>
      </div>
    </header>

    <section class="stats">
      <div class="card">
        <p>Income</p>
        <h3>{totals.income.toFixed(2)}</h3>
      </div>
      <div class="card">
        <p>Spend</p>
        <h3>{totals.spend.toFixed(2)}</h3>
      </div>
      <div class="card">
        <p>Net</p>
        <h3>{totals.net.toFixed(2)}</h3>
      </div>
      <div class="card">
        <p>Transactions</p>
        <h3>{transactions.length}</h3>
      </div>
      <div class="card">
        <p>Recurring groups</p>
        <h3>{recurring.length}</h3>
      </div>
    </section>

    {#if warnings.length}
      <section class="warnings">
        <strong>Warnings</strong>
        <ul>
          {#each warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if loadError}
      <section class="warnings">
        <strong>Load error</strong>
        <p>{loadError}</p>
      </section>
    {/if}

    <section class="dashboard">
      <div class="grid-block recurring-block">
        <div class="recurring-header">
          <div>
            <h2>Recurring payments</h2>
            <p class="subtle">All recurring activity stacked across time.</p>
          </div>
          <div class="recurring-control">
            <label>
              <span>Min confidence</span>
              <div class="slider-row">
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.01"
                  bind:value={recurringConfidence}
                />
                <strong>{recurringConfidence.toFixed(2)}</strong>
              </div>
            </label>
          </div>
        </div>
        <div class="recurring-chart full">
          {#if recurringChartOptions}
            <Chart
              init={echarts.init}
              options={recurringChartOptions}
              style="width: 100%; height: 100%;"
              onclick={(params) => {
                const seriesId =
                  params && typeof params === "object" ? (params as { seriesId?: string }).seriesId : "";
                const seriesName =
                  params && typeof params === "object" ? (params as { seriesName?: string }).seriesName : "";
                if (seriesId) {
                  selectRecurringByKey(seriesId);
                } else if (seriesName) {
                  const match = recurring.find((group) => group.counterparty === seriesName);
                  selectRecurringByKey(match?.key ?? null);
                }
              }}
              ondblclick={(params) => {
                const seriesId =
                  params && typeof params === "object" ? (params as { seriesId?: string }).seriesId : "";
                const seriesName =
                  params && typeof params === "object" ? (params as { seriesName?: string }).seriesName : "";
                if (seriesId) {
                  toggleRecurringVisibilityByKey(seriesId);
                } else if (seriesName) {
                  const match = recurring.find((group) => group.counterparty === seriesName);
                  if (match) toggleRecurringVisibilityByKey(match.key);
                }
              }}
              onlegendselectchanged={(event) => {
                const selected =
                  event && typeof event === "object" ? (event as { selected?: Record<string, boolean> }).selected : null;
                if (!selected) return;
                const next = new Set<string>();
                chartRecurring.forEach((group) => {
                  if (selected[group.counterparty] === false) {
                    next.add(group.key);
                  }
                });
                hiddenRecurringKeys = next;
              }}
            />
          {:else}
            <p class="subtle">No recurring data to chart yet.</p>
          {/if}
        </div>
      </div>
      <div class="panel-block selected-panel">
        <div class="panel-head">
          <h2>Selected recurring payment</h2>
          {#if selectedRecurring}
            <button class="ghost tiny" on:click={() => selectRecurringByKey(null)}>Clear</button>
          {/if}
        </div>
        {#if selectedRecurring}
          <div class="recurring-summary">
            <div class="recurring-counterparty">
              <span>Counterparty</span>
              <strong>{selectedRecurring.counterparty}</strong>
            </div>
            <div>
              <span>Frequency</span>
              <strong>{selectedRecurring.frequency}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>{selectedRecurring.amount.toFixed(2)}</strong>
            </div>
            <div>
              <span>Occurrences</span>
              <strong>{selectedRecurring.occurrences}</strong>
            </div>
            <div>
              <span>Coverage</span>
              <strong>{formatCoverage(selectedRecurring)}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{selectedRecurring.confidence}</strong>
            </div>
            <div>
              <span>Last</span>
              <strong>{formatDate(selectedRecurring.lastDate, "")}</strong>
            </div>
            <div>
              <span>Next</span>
              <strong>{formatDate(selectedRecurring.nextExpected, "")}</strong>
            </div>
            <label class="recurring-toggle">
              <span>Show in chart</span>
              <input
                type="checkbox"
                checked={!hiddenRecurringKeys.has(selectedRecurring.key)}
                on:change={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  setRecurringVisibility(selectedRecurring.key, target.checked);
                }}
              />
            </label>
          </div>
          <div class="recurring-detail-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {#each selectedRecurringTxs as tx}
                  <tr>
                    <td class="nowrap">{formatDate(tx.date, tx.rawDate)}</td>
                    <td>{tx.amount.toFixed(2)}</td>
                    <td>{tx.title ?? ""}</td>
                    <td>{tx.message ?? ""}</td>
                    <td>{tx.reference ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="subtle">Click a series in the chart or a name below to see details.</p>
        {/if}
      </div>
    </section>

    <section class="panel-row">
      <div class="panel-block">
        <h2>Top recurring counterparties</h2>
        <div class="panel-table">
          <table>
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Total</th>
                <th>Avg</th>
                <th>Freq</th>
              </tr>
            </thead>
            <tbody>
              {#each topRecurring as row}
                <tr>
                  <td>
                    <button class="link" on:click={() => selectRecurringByKey(row.key)}>
                      {row.counterparty}
                    </button>
                  </td>
                  <td>{row.totalAmount.toFixed(2)}</td>
                  <td>{(row.totalAmount / row.occurrences).toFixed(2)}</td>
                  <td>{row.frequency}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel-block">
        <h2>Top spend</h2>
        <div class="panel-table">
          <table>
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Total</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {#each spend.slice(0, topN) as row}
                <tr>
                  <td>{row.counterparty}</td>
                  <td>{row.total.toFixed(2)}</td>
                  <td>{row.count}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel-block">
        <h2>Top income</h2>
        <div class="panel-table">
          <table>
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Total</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {#each income.slice(0, topN) as row}
                <tr>
                  <td>{row.counterparty}</td>
                  <td>{row.total.toFixed(2)}</td>
                  <td>{row.count}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel-block">
        <h2>Big one-off spends</h2>
        <div class="panel-table">
          <table>
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Amount</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {#each oneOffBigSpends as row}
                <tr>
                  <td>{row.counterparty ?? "(Unknown)"}</td>
                  <td>{row.amount.toFixed(2)}</td>
                  <td>{formatDate(row.date, row.rawDate)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="grid-block">
      <div class="transactions-head">
        <h2>Transactions</h2>
      </div>
      <div class="filters">
        <input
          type="text"
          placeholder="Search counterparty, message, reference..."
          bind:value={filterSearch}
        />
        <select bind:value={filterDirection}>
          <option value="all">Any direction</option>
          <option value="out">Spend</option>
          <option value="in">Income</option>
        </select>
        <input
          type="number"
          placeholder="Min amount"
          min="0"
          step="0.01"
          bind:value={filterMinAmount}
        />
        <input
          type="number"
          placeholder="Max amount"
          min="0"
          step="0.01"
          bind:value={filterMaxAmount}
        />
        <select bind:value={filterRecurringFilter}>
          <option value="all">Any type</option>
          <option value="recurring">Recurring</option>
          <option value="non-recurring">Non-recurring</option>
        </select>
      </div>
      {#if selectedTransactionSeriesName}
        <div class="chart-selected">
          Selected series: {selectedTransactionSeriesName}
        </div>
      {/if}
      <div class="transactions-chart">
        {#if transactionsChartOptions}
          <Chart
            init={echarts.init}
            options={transactionsChartOptions}
            style="width: 100%; height: 100%;"
            onclick={(params) => {
              const seriesName =
                params && typeof params === "object" ? (params as { seriesName?: string }).seriesName : "";
              selectedTransactionSeriesName = seriesName ?? "";
            }}
            ondblclick={(params) => {
              const seriesName =
                params && typeof params === "object" ? (params as { seriesName?: string }).seriesName : "";
              if (seriesName) {
                toggleTransactionVisibilityByName(seriesName);
              }
            }}
            onlegendselectchanged={(event) => {
              const selected =
                event && typeof event === "object" ? (event as { selected?: Record<string, boolean> }).selected : null;
              if (!selected) return;
              const next = new Set<string>();
              transactionsSeries.forEach((series) => {
                if (selected[series.name] === false) {
                  next.add(series.name);
                }
              });
              hiddenTransactionGroups = next;
            }}
          />
        {:else}
          <p class="subtle">No transactions to chart.</p>
        {/if}
      </div>
      <Grid columns={transactionColumns} data={transactionRows} />
    </section>

  </main>
</Willow>
