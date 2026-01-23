import { parseAmount, parseDate, pickFirst } from '../core/normalize'
import type { ParserResult, Transaction } from '../core/model'

const HEADER_ALIASES: Record<string, string[]> = {
	date: ['Kirjauspäivä'],
	amount: ['Määrä'],
	payer: ['Maksaja'],
	payee: ['Maksunsaaja'],
	name: ['Nimi'],
	title: ['Otsikko'],
	message: ['Viesti'],
	reference: ['Viitenumero'],
	currency: ['Valuutta'],
}

function splitLine(line: string): string[] {
	return line.split(';').map((cell) => cell.replace(/^\uFEFF/, '').trim())
}

function findHeaderIndex(headers: string[], label: string): number {
	const options = HEADER_ALIASES[label] ?? [label]
	return headers.findIndex((header) => options.includes(header))
}

export function parseNordeaCsv(text: string): ParserResult {
	const rows = text.split(/\r?\n/).filter(Boolean)
	if (!rows.length) return { transactions: [], warnings: ['Empty file'] }

	const headers = splitLine(rows[0])
	const indices = {
		date: findHeaderIndex(headers, 'date'),
		amount: findHeaderIndex(headers, 'amount'),
		payer: findHeaderIndex(headers, 'payer'),
		payee: findHeaderIndex(headers, 'payee'),
		name: findHeaderIndex(headers, 'name'),
		title: findHeaderIndex(headers, 'title'),
		message: findHeaderIndex(headers, 'message'),
		reference: findHeaderIndex(headers, 'reference'),
		currency: findHeaderIndex(headers, 'currency'),
	}

	const warnings: string[] = []
	if (indices.date === -1 || indices.amount === -1) {
		warnings.push('Missing required columns (Kirjauspäivä, Määrä)')
	}

	const transactions: Transaction[] = []

	for (let i = 1; i < rows.length; i += 1) {
		const cells = splitLine(rows[i])
		if (cells.length < 2) continue

		const rawDate = indices.date >= 0 ? (cells[indices.date] ?? '') : ''
		const amountRaw =
			indices.amount >= 0 ? (cells[indices.amount] ?? '') : ''
		const amount = parseAmount(amountRaw)
		if (amount === null) continue

		const date = parseDate(rawDate)
		const currency =
			indices.currency >= 0 ? (cells[indices.currency] ?? null) : null
		const payer = indices.payer >= 0 ? (cells[indices.payer] ?? null) : null
		const payee = indices.payee >= 0 ? (cells[indices.payee] ?? null) : null
		const name = indices.name >= 0 ? (cells[indices.name] ?? null) : null
		const title = indices.title >= 0 ? (cells[indices.title] ?? null) : null
		const message =
			indices.message >= 0 ? (cells[indices.message] ?? null) : null
		const reference =
			indices.reference >= 0 ? (cells[indices.reference] ?? null) : null

		const counterparty = pickFirst(name, title, message, payee, payer)
		const direction = amount >= 0 ? 'in' : 'out'

		const raw: Record<string, string> = {}
		headers.forEach((header, idx) => {
			raw[header] = cells[idx] ?? ''
		})

		transactions.push({
			id: `${i}-${amountRaw}-${rawDate}`,
			date,
			rawDate,
			amount,
			currency,
			direction,
			counterparty,
			name,
			title,
			message,
			reference,
			payer,
			payee,
			raw,
		})
	}

	return { transactions, warnings }
}
