import { readFileSync, writeFileSync } from 'node:fs'
import { parseTransactions } from '../parsers'
import { detectRecurring } from '../core/recurring'
import {
	splitSpendIncome,
	summarizeCounterparties,
	summarizeTotals,
} from '../core/analysis'
import type { Transaction } from '../core/model'

function usage() {
	console.log(
		'Usage: npm run cli -- <file> [--json out.json] [--csv out.csv]'
	)
}

function toCsv(transactions: Transaction[]): string {
	const headers = [
		'date',
		'amount',
		'direction',
		'counterparty',
		'name',
		'title',
		'message',
		'reference',
		'currency',
	]
	const lines = [headers.join(',')]
	for (const tx of transactions) {
		const row = [
			tx.date ? tx.date.toISOString().slice(0, 10) : tx.rawDate,
			tx.amount.toString(),
			tx.direction,
			tx.counterparty ?? '',
			tx.name ?? '',
			tx.title ?? '',
			tx.message ?? '',
			tx.reference ?? '',
			tx.currency ?? '',
		].map((cell) => `"${cell.replace(/"/g, '""')}"`)
		lines.push(row.join(','))
	}
	return lines.join('\n')
}

function getArgValue(flag: string, args: string[]): string | null {
	const idx = args.indexOf(flag)
	if (idx === -1) return null
	return args[idx + 1] ?? null
}

const args = process.argv.slice(2)
if (!args.length) {
	usage()
	process.exit(1)
}

const file = args[0]
const jsonOut = getArgValue('--json', args)
const csvOut = getArgValue('--csv', args)

const text = readFileSync(file, 'utf8')
const { transactions, warnings } = parseTransactions('nordea', text)
const totals = summarizeTotals(transactions)
const summaries = summarizeCounterparties(transactions)
const { spend, income } = splitSpendIncome(summaries)
const recurring = detectRecurring(transactions)

console.log('\nTransactions:', transactions.length)
console.log('Income:', totals.income.toFixed(2))
console.log('Spend:', totals.spend.toFixed(2))
console.log('Net:', totals.net.toFixed(2))

if (warnings.length) {
	console.log('\nWarnings:')
	warnings.forEach((w) => console.log(`- ${w}`))
}

console.log('\nTop spend (by counterparty):')
console.table(spend.slice(0, 10))

console.log('\nTop income (by counterparty):')
console.table(income.slice(0, 10))

console.log('\nRecurring groups:')
console.table(
	recurring.slice(0, 10).map((group) => ({
		counterparty: group.counterparty,
		frequency: group.frequency,
		occurrences: group.occurrences,
		amount: group.amount,
		confidence: group.confidence,
		lastDate: group.lastDate.toISOString().slice(0, 10),
	}))
)

if (jsonOut) {
	writeFileSync(
		jsonOut,
		JSON.stringify({ transactions, totals, summaries, recurring }, null, 2),
		'utf8'
	)
	console.log(`\nWrote JSON to ${jsonOut}`)
}

if (csvOut) {
	writeFileSync(csvOut, toCsv(transactions), 'utf8')
	console.log(`Wrote CSV to ${csvOut}`)
}
