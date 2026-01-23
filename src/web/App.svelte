<script lang="ts">
  import { onMount } from "svelte";
  import { Chart } from "svelte-echarts";
  import * as echarts from "echarts";
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
  let filterRecurringOnly = false;
  const topN = 10;

  const transactionColumns = [
    { id: "date", header: { text: "Date" }, width: 110 },
    { id: "amount", header: { text: "Amount" }, width: 110 },
    { id: "direction", header: { text: "Dir" }, width: 70 },
    { id: "counterparty", header: { text: "Counterparty" }, width: 220 },
    { id: "title", header: { text: "Title" }, width: 220 },
    { id: "message", header: { text: "Message" }, width: 220 },
    { id: "reference", header: { text: "Reference" }, width: 150 },
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
      roundAmount(tx.amount, 0.01).toFixed(2),
      tx.currency ?? "",
    ].join("|");
  }

  $: filteredTransactions = (() => {
    const direction = filterDirection;
    const min = filterMinAmount ? Number(filterMinAmount) : null;
    const max = filterMaxAmount ? Number(filterMaxAmount) : null;
    const recurringOnly = filterRecurringOnly;
    const needle = filterSearch.trim().toLowerCase();
    const keySet = recurringKeySet;

    return transactions.filter((tx) => {
      if (direction !== "all" && tx.direction !== direction) return false;
      if (min !== null && !Number.isNaN(min) && Math.abs(tx.amount) < min) return false;
      if (max !== null && !Number.isNaN(max) && Math.abs(tx.amount) > max) return false;
      if (recurringOnly && !keySet.has(getRecurringKey(tx))) return false;
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

  function toIsoDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  function buildMonthAxis(): string[] {
    const allRecurringDates = recurring.flatMap((group) => group.dates);
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

    const allDates = transactions.map((tx) => tx.date).filter((d): d is Date => !!d);
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

  function sumByMonth(group: RecurringGroup, axis: string[]): number[] {
    const sums = new Map<string, number>();
    group.dates.forEach((date) => {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      sums.set(key, (sums.get(key) ?? 0) + group.amount);
    });
    return axis.map((key) => sums.get(key) ?? 0);
  }

  function gradient(color: string) {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color },
      { offset: 1, color: "rgba(255,255,255,0.0)" },
    ]);
  }

  $: monthAxis = buildMonthAxis();

  const chartColors = [
    "#1f2328",
    "#9c7f64",
    "#4d7c6b",
    "#b85c5c",
    "#6b78a5",
    "#e07a5f",
    "#3d405b",
    "#81b29a",
  ];

  $: recurringChartOptions = recurring.length && monthAxis.length
    ? {
        tooltip: {
          trigger: "axis",
        },
        legend: { type: "scroll", top: 0, textStyle: { color: "#5b5f66" } },
        grid: {
          left: 40,
          right: 20,
          top: 40,
          bottom: 30,
        },
        xAxis: {
          type: "category",
          data: monthAxis,
          boundaryGap: false,
        },
        yAxis: {
          type: "value",
        },
        series: recurring.slice(0, 8).map((group, idx) => ({
          name: group.counterparty,
          type: "line",
          stack: "total",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 0 },
          areaStyle: {
            opacity: 0.9,
            color: gradient(chartColors[idx % chartColors.length]),
          },
          emphasis: { focus: "series" },
          data: sumByMonth(group, monthAxis),
        })),
      }
    : null;

  $: topRecurring = [...recurring]
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))
    .slice(0, topN);

  $: oneOffBigSpends = transactions
    .filter((tx) => tx.direction === "out" && !recurringKeySet.has(getRecurringKey(tx)))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, topN);

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

    recurring = detectRecurring(transactions);
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

      recurring = detectRecurring(transactions);
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
              <button class="ghost" on:click={refreshSamples}>Refresh</button>
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
        </div>
        <div class="recurring-chart full">
          {#if recurringChartOptions}
            <Chart
              init={echarts.init}
              options={recurringChartOptions}
              style="width: 100%; height: 100%;"
            />
          {:else}
            <p class="subtle">No recurring data to chart yet.</p>
          {/if}
        </div>
      </div>
      <div class="side-panel">
        <div class="panel-block">
          <h2>Top recurring counterparties</h2>
          <ol>
            {#each topRecurring as row}
              <li>{row.counterparty} — {row.totalAmount.toFixed(2)} ({row.frequency})</li>
            {/each}
          </ol>
        </div>
        <div class="panel-block">
          <h2>Top spend</h2>
          <ol>
            {#each spend.slice(0, topN) as row}
              <li>{row.counterparty} — {row.total.toFixed(2)} ({row.count})</li>
            {/each}
          </ol>
        </div>
        <div class="panel-block">
          <h2>Top income</h2>
          <ol>
            {#each income.slice(0, topN) as row}
              <li>{row.counterparty} — {row.total.toFixed(2)} ({row.count})</li>
            {/each}
          </ol>
        </div>
        <div class="panel-block">
          <h2>Big one-off spends</h2>
          <ol>
            {#each oneOffBigSpends as row}
              <li>{row.counterparty ?? "(Unknown)"} — {row.amount.toFixed(2)} ({formatDate(row.date, row.rawDate)})</li>
            {/each}
          </ol>
        </div>
      </div>
    </section>

    <section class="grid-block">
      <div class="transactions-head">
        <h2>Transactions</h2>
        <div class="filters">
          <input
            type="text"
            placeholder="Search counterparty, message, reference..."
            bind:value={filterSearch}
          />
          <select bind:value={filterDirection}>
            <option value="all">All</option>
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
          <label class="toggle">
            <input type="checkbox" bind:checked={filterRecurringOnly} />
            <span>Recurring only</span>
          </label>
        </div>
      </div>
      <Grid columns={transactionColumns} data={transactionRows} id="tx-grid" />
    </section>

  </main>
</Willow>
