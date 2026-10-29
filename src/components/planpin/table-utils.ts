import type { IssueTable } from './types';

/** Read numbers without changing the source cell text (Dutch and EN formats). */
export function parseTableNumber(value: string): number | null {
	let text = value.trim().replace(/[\s\u00a0€]/g, '').replace(/−/g, '-').replace(/EUR/gi, '');
	if (!text || /^[-–—]$/.test(text) || text.includes('%')) return null;
	if (/^\(.*\)$/.test(text)) text = '-' + text.slice(1, -1);
	if (text.includes(',') && text.includes('.')) {
		text = text.lastIndexOf(',') > text.lastIndexOf('.')
			? text.replace(/\./g, '').replace(',', '.')
			: text.replace(/,/g, '');
	} else if (text.includes(',')) {
		text = text.replace(',', '.');
	} else if ((text.match(/\./g) ?? []).length > 1) {
		text = text.replace(/\./g, '');
	}
	if (!/^[+-]?\d*(?:\.\d+)?$/.test(text) || !/\d/.test(text)) return null;
	const result = Number(text);
	return Number.isFinite(result) ? result : null;
}

export function tableTotals(table: IssueTable): Record<string, string> {
	const values: Record<string, string> = {};
	for (const col of table.totals) {
		const index = table.columns.indexOf(col);
		if (index < 0) continue;
		const parsed = table.rows
			.map((row) => parseTableNumber(row[index] ?? ''))
			.filter((number): number is number => number !== null);
		values[col] = parsed.length
			? new Intl.NumberFormat('nl-BE', {
					minimumFractionDigits: 2,
					maximumFractionDigits: 4,
				}).format(parsed.reduce((sum, value) => sum + value, 0))
			: '—';
	}
	return values;
}
