import {
	PDFDocument,
	PDFName,
	StandardFonts,
	type PDFFont,
	type PDFImage,
	type PDFPage,
	rgb,
} from 'pdf-lib';
import { getExportableImageBytes } from './export-images';
import {
	PLANPIN_MANIFEST_ATTACHMENT_NAME,
	PLANPIN_MANIFEST_KEYWORD,
	PLANPIN_SOURCE_ATTACHMENT_NAME,
	createIssueImageAttachmentName,
	createPlanPinManifest,
	serializePlanPinManifest,
} from './manifest';
import {
	getIssueCategoryLabel,
	getIssuePriorityLabel,
	getIssueStatusLabel,
} from './labels';
import { getMarkerDisplayNumber, getMarkerDisplayTitle, getMarkerIssueNumber } from './markers';
import { tableTotals } from './table-utils';
import type { IssueCategory, IssueMarker, IssueMarkerImage, IssueStatus } from './types';

interface ExportPlanPinPdfOptions {
	fileName: string;
	sourceBytes: Uint8Array;
	markers: IssueMarker[];
}

interface MarkerExportTarget {
	issuePage: PDFPage;
	exportNumber: number;
}

interface EmbeddedIssueImage {
	image: PDFImage;
	source: IssueMarkerImage;
}

const GRONDLAAG_WEBSITE_URL = 'https://grondlaag.be';

function addExternalLinkAnnotation({
	page,
	url,
	x,
	y,
	width,
	height,
}: {
	page: PDFPage;
	url: string;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const context = page.doc.context;
	const annotation = context.obj({
		Type: PDFName.of('Annot'),
		Subtype: PDFName.of('Link'),
		Rect: [x, y, x + width, y + height],
		Border: [0, 0, 0],
		A: {
			S: PDFName.of('URI'),
			URI: url,
		},
	});

	const annotationRef = context.register(annotation);
	page.node.addAnnot(annotationRef);
}

function drawExportBranding({
	page,
	font,
	boldFont,
	exportedAt,
}: {
	page: PDFPage;
	font: PDFFont;
	boldFont: PDFFont;
	exportedAt: string;
}) {
	const { width } = page.getSize();
	const margin = 48;
	const footerY = 24;
	const accentColor = rgb(0.94, 0.78, 0.45);
	const mutedColor = rgb(0.36, 0.34, 0.31);
	const exportLabel = `geëxporteerd op ${exportedAt}`;
	const brandLabel = 'grondlaag';
	const websiteLabel = 'grondlaag.be';
	const websiteWidth = boldFont.widthOfTextAtSize(websiteLabel, 9);

	page.drawLine({
		start: { x: margin, y: footerY + 13 },
		end: { x: width - margin, y: footerY + 13 },
		thickness: 0.6,
		color: rgb(0.88, 0.84, 0.77),
		opacity: 0.35,
	});

	page.drawText(brandLabel, {
		x: margin,
		y: footerY,
		size: 9,
		font: boldFont,
		color: accentColor,
	});

	page.drawText(exportLabel, {
		x: margin + 50,
		y: footerY,
		size: 8.5,
		font,
		color: mutedColor,
	});

	page.drawText(websiteLabel, {
		x: width - margin - websiteWidth,
		y: footerY,
		size: 9,
		font: boldFont,
		color: accentColor,
	});

	addExternalLinkAnnotation({
		page,
		url: GRONDLAAG_WEBSITE_URL,
		x: width - margin - websiteWidth,
		y: footerY - 2,
		width: websiteWidth,
		height: 14,
	});
}

function drawOverviewPage({
	page,
	fileName,
	markers,
	font,
	boldFont,
	exportedAt,
}: {
	page: PDFPage;
	fileName: string;
	markers: IssueMarker[];
	font: PDFFont;
	boldFont: PDFFont;
	exportedAt: string;
}) {
	const { width, height } = page.getSize();
	const margin = 48;
	const textColor = rgb(0.14, 0.14, 0.13);
	const mutedColor = rgb(0.36, 0.34, 0.31);
	const accentColor = rgb(0.94, 0.78, 0.45);
	let currentY = height - margin;

	const categorySummary = new Map<string, number>();
	const statusSummary = new Map<string, number>();
	const pageSummary = new Map<number, number>();

	for (const marker of markers) {
		categorySummary.set(marker.category, (categorySummary.get(marker.category) ?? 0) + 1);
		statusSummary.set(marker.status, (statusSummary.get(marker.status) ?? 0) + 1);
		pageSummary.set(marker.pageNumber, (pageSummary.get(marker.pageNumber) ?? 0) + 1);
	}

	page.drawText('PlanPin Overzicht', {
		x: margin,
		y: currentY,
		size: 24,
		font: boldFont,
		color: textColor,
	});

	currentY -= 28;
	page.drawText(fileName, {
		x: margin,
		y: currentY,
		size: 11,
		font,
		color: mutedColor,
	});

	currentY -= 24;
	page.drawText(`Totaal opmerkingen: ${markers.length}`, {
		x: margin,
		y: currentY,
		size: 12,
		font: boldFont,
		color: accentColor,
	});

	currentY -= 28;
	page.drawText('Per categorie', {
		x: margin,
		y: currentY,
		size: 12,
		font: boldFont,
		color: textColor,
	});

	currentY -= 18;
	for (const [category, count] of categorySummary) {
		page.drawText(`${getIssueCategoryLabel(category as IssueCategory)}: ${count}`, {
			x: margin,
			y: currentY,
			size: 10,
			font,
			color: mutedColor,
		});
		currentY -= 14;
	}

	currentY -= 10;
	page.drawText('Per status', {
		x: margin,
		y: currentY,
		size: 12,
		font: boldFont,
		color: textColor,
	});

	currentY -= 18;
	for (const [status, count] of statusSummary) {
		page.drawText(`${getIssueStatusLabel(status as IssueStatus)}: ${count}`, {
			x: margin,
			y: currentY,
			size: 10,
			font,
			color: mutedColor,
		});
		currentY -= 14;
	}

	currentY -= 10;
	page.drawText('Per pagina', {
		x: margin,
		y: currentY,
		size: 12,
		font: boldFont,
		color: textColor,
	});

	currentY -= 18;
	for (const [pageNumber, count] of [...pageSummary.entries()].sort((left, right) => left[0] - right[0])) {
		page.drawText(`pagina ${pageNumber}: ${count}`, {
			x: margin,
			y: currentY,
			size: 10,
			font,
			color: mutedColor,
		});
		currentY -= 14;
	}

	currentY -= 10;
	page.drawText('Opmerkingenlijst', {
		x: margin,
		y: currentY,
		size: 12,
		font: boldFont,
		color: textColor,
	});

	currentY -= 18;
	for (const marker of markers) {
		const issueNumber = getMarkerIssueNumber(marker.id, markers);
		const line = `Opmerking ${getMarkerDisplayNumber(marker, issueNumber)}  |  pagina ${marker.pageNumber}  |  ${getMarkerDisplayTitle(marker, issueNumber)}  |  ${getIssueCategoryLabel(marker.category)} / ${getIssueStatusLabel(marker.status)}`;

		page.drawText(line, {
			x: margin,
			y: currentY,
			size: 9,
			font,
			color: mutedColor,
			maxWidth: width - margin * 2,
		});
		currentY -= 13;

		if (currentY < margin + 24) {
			break;
		}
	}

	drawExportBranding({
		page,
		font,
		boldFont,
		exportedAt,
	});
}

function addInternalLinkAnnotation({
	page,
	targetPage,
	x,
	y,
	width,
	height,
}: {
	page: PDFPage;
	targetPage: PDFPage;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const context = page.doc.context;
	const annotation = context.obj({
		Type: PDFName.of('Annot'),
		Subtype: PDFName.of('Link'),
		Rect: [x, y, x + width, y + height],
		Border: [0, 0, 0],
		A: {
			S: PDFName.of('GoTo'),
			D: [targetPage.ref, PDFName.of('Fit')],
		},
	});

	const annotationRef = context.register(annotation);
	page.node.addAnnot(annotationRef);
}

function wrapText({
	text,
	font,
	fontSize,
	maxWidth,
}: {
	text: string;
	font: PDFFont;
	fontSize: number;
	maxWidth: number;
}): string[] {
	const lines: string[] = [];
	const normalizedText = text.trim().replace(/\r\n/g, '\n');

	for (const paragraph of normalizedText.split('\n')) {
		if (!paragraph.trim()) {
			lines.push('');
			continue;
		}

		let currentLine = '';

		for (const word of paragraph.split(/\s+/)) {
			const candidate = currentLine ? `${currentLine} ${word}` : word;

			if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
				currentLine = candidate;
				continue;
			}

			if (currentLine) {
				lines.push(currentLine);
			}

			currentLine = word;
		}

		if (currentLine) {
			lines.push(currentLine);
		}
	}

	return lines.length > 0 ? lines : [''];
}

function getImagePlacementBoxes({
	pageWidth,
	startY,
	availableHeight,
	imageCount,
}: {
	pageWidth: number;
	startY: number;
	availableHeight: number;
	imageCount: number;
}) {
	if (imageCount <= 1) {
		return [
			{
				x: 48,
				y: startY - availableHeight,
				width: pageWidth - 96,
				height: availableHeight,
			},
		];
	}

	const gap = 16;
	const columns = imageCount === 2 ? 1 : 2;
	const rows = Math.min(2, Math.ceil(imageCount / columns));
	const width = (pageWidth - 96 - gap * (columns - 1)) / columns;
	const height = (availableHeight - gap * (rows - 1)) / rows;
	const boxes = [];

	for (let index = 0; index < imageCount; index += 1) {
		const column = columns === 1 ? 0 : index % columns;
		const row = columns === 1 ? index : Math.floor(index / columns);

		boxes.push({
			x: 48 + column * (width + gap),
			y: startY - row * (height + gap) - height,
			width,
			height,
		});
	}

	return boxes;
}

async function tryEmbedImage(
	pdfDocument: PDFDocument,
	image: IssueMarkerImage,
): Promise<EmbeddedIssueImage | null> {
	if (!image.file) {
		return null;
	}

	try {
		const preparedImage = await getExportableImageBytes(image);

		if (!preparedImage) {
			return null;
		}

		if (preparedImage.mimeType === 'image/png') {
			return {
				image: await pdfDocument.embedPng(preparedImage.bytes),
				source: image,
			};
		}

		if (preparedImage.mimeType === 'image/jpeg') {
			return {
				image: await pdfDocument.embedJpg(preparedImage.bytes),
				source: image,
			};
		}
	} catch {
		return null;
	}

	return null;
}

async function drawIssuePage({
	pdfDocument,
	issuePage,
	planPage,
	marker,
	exportNumber,
	font,
	boldFont,
	exportedAt,
}: {
	pdfDocument: PDFDocument;
	issuePage: PDFPage;
	planPage: PDFPage;
	marker: IssueMarker;
	exportNumber: number;
	font: PDFFont;
	boldFont: PDFFont;
	exportedAt: string;
}) {
	const { width, height } = issuePage.getSize();
	const margin = 48;
	const accentColor = rgb(0.94, 0.78, 0.45);
	const textColor = rgb(0.14, 0.14, 0.13);
	const mutedColor = rgb(0.36, 0.34, 0.31);
	const contentWidth = width - margin * 2;
	const title = getMarkerDisplayTitle(marker, exportNumber);
	const comment = marker.comment.trim() || 'Geen commentaar opgegeven.';
	let currentY = height - margin;

	issuePage.drawText(`Opmerking ${getMarkerDisplayNumber(marker, exportNumber)}`, {
		x: margin,
		y: currentY,
		size: 24,
		font: boldFont,
		color: textColor,
	});

	const backLinkText = `Terug naar planpagina ${marker.pageNumber}`;
	const backLinkWidth = boldFont.widthOfTextAtSize(backLinkText, 11);
	const backLinkY = currentY + 6;

	issuePage.drawText(backLinkText, {
		x: width - margin - backLinkWidth,
		y: backLinkY,
		size: 11,
		font: boldFont,
		color: accentColor,
	});
	addInternalLinkAnnotation({
		page: issuePage,
		targetPage: planPage,
		x: width - margin - backLinkWidth,
		y: backLinkY - 2,
		width: backLinkWidth,
		height: 16,
	});

	currentY -= 34;
	issuePage.drawText(title, {
		x: margin,
		y: currentY,
		size: 18,
		font: boldFont,
		color: textColor,
	});

	currentY -= 24;
	issuePage.drawText(
		`Planpagina ${marker.pageNumber}  |  ${marker.images.length} afbeelding${marker.images.length === 1 ? '' : 'en'}  |  opmerking ${getMarkerDisplayNumber(marker, exportNumber)}  |  ${getIssueCategoryLabel(marker.category)} / ${getIssueStatusLabel(marker.status)} / ${getIssuePriorityLabel(marker.priority)}`,
		{
			x: margin,
			y: currentY,
			size: 10,
			font,
			color: mutedColor,
		},
	);

	currentY -= 20;
	const commentLines = wrapText({
		text: comment,
		font,
		fontSize: 11,
		maxWidth: contentWidth,
	});

	for (const line of commentLines) {
		issuePage.drawText(line, {
			x: margin,
			y: currentY,
			size: 11,
			font,
			color: textColor,
		});
		currentY -= 15;
	}

	currentY -= 8;
	const embeddedImages: EmbeddedIssueImage[] = [];
	const skippedImages: IssueMarkerImage[] = [];

	for (const image of marker.images.slice(0, 4)) {
		const embeddedImage = await tryEmbedImage(pdfDocument, image);

		if (embeddedImage) {
			embeddedImages.push(embeddedImage);
		} else {
			skippedImages.push(image);
		}
	}

	const omittedImageCount = Math.max(marker.images.length - 4, 0);
	const imageAreaHeight = Math.max(180, currentY - margin - 24);

	if (embeddedImages.length > 0) {
		const boxes = getImagePlacementBoxes({
			pageWidth: width,
			startY: currentY,
			availableHeight: imageAreaHeight,
			imageCount: embeddedImages.length,
		});

		embeddedImages.forEach((embeddedImage, index) => {
			const box = boxes[index];
			const dimensions = embeddedImage.image.scaleToFit(box.width, box.height);
			const imageX = box.x + (box.width - dimensions.width) / 2;
			const imageY = box.y + (box.height - dimensions.height) / 2;

			issuePage.drawRectangle({
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
				color: rgb(0.95, 0.95, 0.93),
				borderColor: rgb(0.82, 0.8, 0.76),
				borderWidth: 1,
			});
			issuePage.drawImage(embeddedImage.image, {
				x: imageX,
				y: imageY,
				width: dimensions.width,
				height: dimensions.height,
			});
			issuePage.drawText(embeddedImage.source.name, {
				x: box.x,
				y: Math.max(margin, box.y - 14),
				size: 9,
				font,
				color: mutedColor,
			});
		});
	}

	let footerY = margin - 8;

	if (skippedImages.length > 0) {
		issuePage.drawText(
			`Niet-ondersteunde afbeeldingsformaten overgeslagen: ${skippedImages.map((image) => image.name).join(', ')}`,
			{
				x: margin,
				y: footerY,
				size: 9,
				font,
				color: mutedColor,
			},
		);
		footerY += 14;
	}

	if (omittedImageCount > 0) {
		issuePage.drawText(
			`${omittedImageCount} extra afbeelding${omittedImageCount === 1 ? '' : 'en'} niet getoond in deze MVP-export.`,
			{
				x: margin,
				y: footerY,
				size: 9,
				font,
				color: mutedColor,
			},
		);
	}

	drawExportBranding({
		page: issuePage,
		font,
		boldFont,
		exportedAt,
	});
}

function drawIssueTablePages({
	pdfDocument,
	marker,
	issuePage,
	planPage,
	exportNumber,
	font,
	boldFont,
	exportedAt,
}: {
	pdfDocument: PDFDocument;
	marker: IssueMarker;
	issuePage: PDFPage;
	planPage: PDFPage;
	exportNumber: number;
	font: PDFFont;
	boldFont: PDFFont;
	exportedAt: string;
}): void {
	const table = marker.table;
	if (!table || table.columns.length === 0 || table.rows.length === 0) return;
	const margin = 48;
	const pageWidth = 612;
	const availableWidth = pageWidth - margin * 2;
	const totals = tableTotals(table);
	const weights = table.columns.map((col, i) => {
		const values = table.rows.slice(0, 80).map((row) => row[i] ?? '');
		const maxLength = Math.max(col.length, ...values.map((value) => value.length));
		const mostlyNumeric = values.length > 0 &&
			values.filter((value) => /^[\s€+\-\d.,]+$/.test(value)).length >= values.length * 0.6;
		return Math.max(7, Math.min(mostlyNumeric ? 14 : 42, Math.max(col.length, maxLength)));
	});
	const totalWeight = weights.reduce((sum, value) => sum + value, 0);
	const widths = weights.map((w) => w / totalWeight * availableWidth);
	let page: PDFPage | null = null;
	let y = 0;
	let rowIndex = 0;
	let footerPending = table.totals.length > 0;
	let firstTablePage: PDFPage | null = null;
	const ink = rgb(0.18, 0.18, 0.18);
	const rule = rgb(0.8, 0.81, 0.82);

	function cellLines(value: string, width: number): string[] {
		const normalized = value.replace(/[\u2028\u2029]/g, ' ').replace(/\r/g, '');
		const raw = wrapText({ text: normalized, font, fontSize: 7.4, maxWidth: Math.max(8, width - 6) });
		const results: string[] = [];
		for (const line of raw) {
			if (font.widthOfTextAtSize(line, 7.4) <= width - 6) {
				results.push(line);
			} else {
				// Break long unsplittable words to fit narrow Grasshopper columns.
				let fragment = '';
				for (const char of line) {
					if (fragment && font.widthOfTextAtSize(fragment + char, 7.4) > width - 6) {
						results.push(fragment);
						fragment = char;
					} else fragment += char;
				}
				if (fragment) results.push(fragment);
			}
		}
		return results;
	}
	function getCellLines(values: string[]): string[][] {
		return values.map((value, i) => cellLines(value, widths[i]));
	}
	function rowHeight(lines: string[][]): number {
		return Math.max(20, 9 + Math.max(...lines.map((value) => value.length)) * 10);
	}
	function drawRow(values: string[], bold = false, shaded = false) {
		if (!page) return;
		const lines = getCellLines(values);
		const height = rowHeight(lines);
		page.drawRectangle({
			x: margin, y: y - height, width: availableWidth, height,
			color: shaded ? rgb(0.96, 0.965, 0.97) : rgb(1, 1, 1),
			borderColor: rule, borderWidth: 0.35,
		});
		let x = margin;
		for (let i = 0; i < values.length; i++) {
			for (let j = 0; j < lines[i].length; j++) {
				page.drawText(lines[i][j], {
					x: x + 3, y: y - 11 - j * 10, font: bold ? boldFont : font,
					size: 7.4, color: ink,
				});
			}
			x += widths[i];
		}
		y -= height;
	}
	function newTablePage() {
		page = pdfDocument.addPage([612, 792]);
		if (!firstTablePage) firstTablePage = page;
		page.drawText(`Opmerking ${getMarkerDisplayNumber(marker, exportNumber)} - tabel`, {
			x: margin, y: 741, size: 18, font: boldFont, color: ink,
		});
		y = 709;
		const headingLines = getCellLines(table!.columns);
		const headingHeight = Math.max(26, rowHeight(headingLines));
		page.drawRectangle({ x: margin, y: y - headingHeight, width: availableWidth,
			height: headingHeight, color: rgb(0.92, 0.93, 0.94), borderColor: rule, borderWidth: .5 });
		let x = margin;
		for (let i = 0; i < table!.columns.length; i++) {
			for (let j = 0; j < headingLines[i].length; j++) {
				page.drawText(headingLines[i][j], {
					x: x + 3, y: y - 12 - j * 10, font: boldFont, size: 7.4, color: ink,
				});
			}
			x += widths[i];
		}
		y -= headingHeight;
		const returnText = `Terug naar planpagina ${marker.pageNumber}`;
		page.drawText(returnText, { x: margin, y: 51, size: 10, font, color: ink });
		addInternalLinkAnnotation({
			page, targetPage: planPage, x: margin, y: 47, width: 210, height: 15,
		});
		drawExportBranding({ page, font, boldFont, exportedAt });
	}
	newTablePage();
	while (rowIndex < table.rows.length || footerPending) {
		const values = rowIndex < table.rows.length ? table.rows[rowIndex] : table.columns.map((col, j) =>
			Object.prototype.hasOwnProperty.call(totals, col) ? totals[col] : j === 0 ? 'Totaal' : '');
		const height = rowHeight(getCellLines(values));
		if (height > 575) {
			throw new Error(`Tabelrij ${rowIndex + 1} van opmerking ${getMarkerDisplayNumber(marker, exportNumber)} is te hoog voor een PDF-pagina.`);
		}
		if (y - height < 79) newTablePage();
		drawRow(values, rowIndex >= table.rows.length, rowIndex % 2 === 1);
		if (rowIndex < table.rows.length) rowIndex += 1;
		else footerPending = false;
	}
	if (firstTablePage) {
		const linkText = `Tabel met ${table.rows.length} rijen bekijken`;
		issuePage.drawText(linkText, { x: margin, y: 58, size: 10, font: boldFont, color: rgb(0.45, 0.35, 0.16) });
		addInternalLinkAnnotation({ page: issuePage, targetPage: firstTablePage,
			x: margin, y: 54, width: 290, height: 16 });
	}
}

function drawPlanMarker({
	page,
	marker,
	target,
}: {
	page: PDFPage;
	marker: IssueMarker;
	target: MarkerExportTarget;
}) {
	const { width, height } = page.getSize();
	const markerX = marker.x * width;
	const markerY = height - marker.y * height;
	const radius = 10;
	const label = getMarkerDisplayNumber(marker, target.exportNumber);
	const fillColor = rgb(0.89, 0.39, 0.23);

	page.drawCircle({
		x: markerX,
		y: markerY,
		size: radius,
		color: fillColor,
		borderColor: rgb(0.32, 0.14, 0.08),
		borderWidth: 1.5,
	});

	page.drawText(label, {
		x: markerX - 3 * Math.max(1, label.length - 0.3),
		y: markerY - 4,
		size: 9,
		color: rgb(1, 1, 1),
	});

	addInternalLinkAnnotation({
		page,
		targetPage: target.issuePage,
		x: markerX - radius - 4,
		y: markerY - radius - 4,
		width: radius * 2 + 8,
		height: radius * 2 + 8,
	});
}

export async function exportPlanPinPdf({
	fileName,
	sourceBytes,
	markers,
}: ExportPlanPinPdfOptions): Promise<{ bytes: Uint8Array; downloadName: string }> {
	const pdfDocument = await PDFDocument.load(sourceBytes);
	const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);
	const exportedAt = new Date().toLocaleString('nl-BE', {
		dateStyle: 'short',
		timeStyle: 'short',
	});
	const planPages = pdfDocument.getPages();
	const totalPlanPages = planPages.length;
	const markerTargets = new Map<string, MarkerExportTarget>();
	const issuePageNumbers = new Map<string, number>();
	const overviewPage = pdfDocument.addPage([612, 792]);

	drawOverviewPage({
		page: overviewPage,
		fileName,
		markers,
		font,
		boldFont,
		exportedAt,
	});

	markers.forEach((marker, index) => {
		const issuePage = pdfDocument.addPage([612, 792]);
		markerTargets.set(marker.id, {
			issuePage,
			exportNumber: index + 1,
		});
		issuePageNumbers.set(marker.id, totalPlanPages + index + 2);
	});

	for (const marker of markers) {
		const target = markerTargets.get(marker.id);
		const planPage = planPages[marker.pageNumber - 1];

		if (!target || !planPage) {
			continue;
		}

		await drawIssuePage({
			pdfDocument,
			issuePage: target.issuePage,
			planPage,
			marker,
			exportNumber: target.exportNumber,
			font,
			boldFont,
			exportedAt,
		});
	}

	for (const marker of markers) {
		const target = markerTargets.get(marker.id);
		const planPage = planPages[marker.pageNumber - 1];

		if (!target || !planPage) {
			continue;
		}

		drawPlanMarker({
			page: planPage,
			marker,
			target,
		});
	}

	// Table pages are appended after original issue pages so issuePageNumber links
	// and the embedded PlanPin manifest remain backwards-compatible.
	for (const marker of markers) {
		const target = markerTargets.get(marker.id);
		const planPage = planPages[marker.pageNumber - 1];
		if (target && planPage && marker.table) {
			drawIssueTablePages({
				pdfDocument, marker, issuePage: target.issuePage, planPage,
				exportNumber: target.exportNumber, font, boldFont, exportedAt,
			});
		}
	}

	for (const marker of markers) {
		for (const image of marker.images) {
			if (!image.file) {
				continue;
			}

			const preparedImage = await getExportableImageBytes(image);

			if (!preparedImage) {
				continue;
			}

			await pdfDocument.attach(
				preparedImage.bytes,
				createIssueImageAttachmentName({
					imageId: image.id,
					fileName: image.name,
				}),
				{
					mimeType: preparedImage.mimeType || 'application/octet-stream',
					description: `PlanPin issue image for marker ${marker.id}`,
				},
			);
		}
	}

	await pdfDocument.attach(sourceBytes, PLANPIN_SOURCE_ATTACHMENT_NAME, {
		mimeType: 'application/pdf',
		description: 'PlanPin original source PDF',
	});

	const manifest = createPlanPinManifest({
		fileName,
		totalPlanPages,
		markers,
		issuePageNumbers,
	});
	const manifestBytes = serializePlanPinManifest(manifest);

	await pdfDocument.attach(manifestBytes, PLANPIN_MANIFEST_ATTACHMENT_NAME, {
		mimeType: 'application/json',
		description: 'PlanPin marker manifest',
		creationDate: new Date(manifest.exportedAt),
		modificationDate: new Date(manifest.exportedAt),
	});
	pdfDocument.setCreator('PlanPin');
	pdfDocument.setProducer('PlanPin');
	pdfDocument.setSubject('PlanPin export with embedded issue manifest');
	pdfDocument.setKeywords([PLANPIN_MANIFEST_KEYWORD, 'planpin', 'issues']);

	const bytes = await pdfDocument.save();
	const downloadName = fileName.toLowerCase().endsWith('.pdf')
		? fileName.replace(/\.pdf$/i, '-planpin.pdf')
		: `${fileName}-planpin.pdf`;

	return { bytes, downloadName };
}
