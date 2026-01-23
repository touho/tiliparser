<script lang="ts">
  import { onMount } from "svelte";
  import { Grid } from "@svar-ui/svelte-grid";
  import { Willow } from "@svar-ui/svelte-core";
  import { parseTransactions } from "../parsers";
  import { detectRecurring } from "../core/recurring";
  import { splitSpendIncome, summarizeCounterparties, summarizeTotals } from "../core/analysis";
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
  const sampleStorageKey = "tiliparser.lastSample";

  const transactionColumns = [
    { id: "date", header: { text: "Date", filter: "text" }, width: 110 },
    { id: "amount", header: { text: "Amount", filter: "text" }, width: 110 },
    { id: "direction", header: { text: "Dir", filter: "text" }, width: 70 },
    { id: "counterparty", header: { text: "Counterparty", filter: "text" }, width: 220 },
    { id: "title", header: { text: "Title", filter: "text" }, width: 220 },
    { id: "message", header: { text: "Message", filter: "text" }, width: 220 },
    { id: "reference", header: { text: "Reference", filter: "text" }, width: 150 },
  ];

  const recurringColumns = [
    { id: "counterparty", header: "Counterparty", width: 220 },
    { id: "frequency", header: "Frequency", width: 120 },
    { id: "occurrences", header: "Count", width: 90 },
    { id: "amount", header: "Amount", width: 110 },
    { id: "confidence", header: "Confidence", width: 110 },
    { id: "lastDate", header: "Last", width: 120 },
    { id: "nextExpected", header: "Next", width: 120 },
  ];

  function formatDate(date: Date | null, fallback: string) {
    return date ? date.toISOString().slice(0, 10) : fallback;
  }

  $: transactionRows = transactions.map((tx) => ({
    date: formatDate(tx.date, tx.rawDate),
    amount: tx.amount.toFixed(2),
    direction: tx.direction,
    counterparty: tx.counterparty ?? "",
    title: tx.title ?? "",
    message: tx.message ?? "",
    reference: tx.reference ?? "",
  }));

  $: recurringRows = recurring.map((group) => ({
    counterparty: group.counterparty,
    frequency: group.frequency,
    occurrences: group.occurrences,
    amount: group.amount.toFixed(2),
    confidence: group.confidence,
    lastDate: group.lastDate.toISOString().slice(0, 10),
    nextExpected: group.nextExpected.toISOString().slice(0, 10),
  }));

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
        sampleError = `Failed to load samples (${response.status})`;
        return;
      }
      const files = (await response.json()) as string[];
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
      </div>
      <div class="uploader">
        <label>
          <span>Bank</span>
          <select bind:value={bank}>
            <option value="nordea">Nordea</option>
          </select>
        </label>
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

    <section class="grid-block">
      <h2>Recurring payments</h2>
      <Grid {recurringColumns} {recurringRows} />
    </section>

    <section class="grid-block">
      <h2>Transactions</h2>
      <Grid {transactionColumns} {transactionRows} />
    </section>

    <section class="split">
      <div>
        <h2>Top spend</h2>
        <ol>
          {#each spend.slice(0, 10) as row}
            <li>{row.counterparty} — {row.total.toFixed(2)} ({row.count})</li>
          {/each}
        </ol>
      </div>
      <div>
        <h2>Top income</h2>
        <ol>
          {#each income.slice(0, 10) as row}
            <li>{row.counterparty} — {row.total.toFixed(2)} ({row.count})</li>
          {/each}
        </ol>
      </div>
    </section>
  </main>
</Willow>
