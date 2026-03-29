import {
	getIssueCategoryLabel,
	getIssuePriorityLabel,
	getIssueStatusLabel,
} from './labels';
import { getMarkerDisplayTitle, getMarkerIssueNumber } from './markers';
import type { IssueMarker } from './types';

function escapeCsvValue(value: string | number): string {
	const stringValue = String(value);

	if (/[",\n]/.test(stringValue)) {
		return `"${stringValue.replace(/"/g, '""')}"`;
	}

	return stringValue;
}

export function exportPlanPinCsv({
	fileName,
	markers,
}: {
	fileName: string;
	markers: IssueMarker[];
}): { csv: string; downloadName: string } {
	const header = [
		'opmerking_nummer',
		'titel',
		'commentaar',
		'pagina_nummer',
		'x',
		'y',
		'categorie',
		'status',
		'prioriteit',
		'referentie',
		'aantal_afbeeldingen',
		'aangemaakt_op',
	];

	const rows = markers.map((marker) => {
		const issueNumber = getMarkerIssueNumber(marker.id, markers);

		return [
			issueNumber,
			getMarkerDisplayTitle(marker, issueNumber),
			marker.comment,
			marker.pageNumber,
			marker.x.toFixed(4),
			marker.y.toFixed(4),
			getIssueCategoryLabel(marker.category),
			getIssueStatusLabel(marker.status),
			getIssuePriorityLabel(marker.priority),
			marker.reference,
			marker.images.length,
			marker.createdAt,
		];
	});

	const csv = [header, ...rows].map((row) => row.map(escapeCsvValue).join(',')).join('\n');
	const downloadName = fileName.toLowerCase().endsWith('.pdf')
		? fileName.replace(/\.pdf$/i, '-planpin-issues.csv')
		: `${fileName}-planpin-issues.csv`;

	return { csv, downloadName };
}
