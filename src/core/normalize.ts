export function normalizeText(value: string | null | undefined): string {
	if (!value) return ''
	return value
		.replace(/\s+/g, ' ')
		.replace(/\u00A0/g, ' ')
		.trim()
}

export function normalizeKey(value: string | null | undefined): string {
	return normalizeText(value).toLowerCase()
}

export function roundAmount(amount: number, tolerance = 0.01): number {
	const factor = Math.max(1, Math.round(1 / tolerance))
	return Math.round(amount * factor) / factor
}

export function parseAmount(value: string | null | undefined): number | null {
	if (!value) return null
	const cleaned = value.replace(/\s/g, '').replace(',', '.')
	const num = Number(cleaned)
	return Number.isFinite(num) ? num : null
}

export function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null
	const trimmed = value.trim()
	if (!trimmed || trimmed.toLowerCase() === 'varaus') return null
	if (trimmed.includes('/')) {
		const parsed = new Date(trimmed)
		return Number.isNaN(parsed.getTime()) ? null : parsed
	}
	if (trimmed.includes('.')) {
		const parts = trimmed.split('.')
		if (parts.length === 3) {
			const [dd, mm, yyyy] = parts
			const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
			return Number.isNaN(parsed.getTime()) ? null : parsed
		}
	}
	const fallback = new Date(trimmed)
	return Number.isNaN(fallback.getTime()) ? null : fallback
}

export function pickFirst(
	...values: Array<string | null | undefined>
): string | null {
	for (const value of values) {
		const normalized = normalizeText(value)
		if (normalized) return normalized
	}
	return null
}
