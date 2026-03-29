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
import { getMarkerDisplayTitle, getMarkerIssueNumber } from './markers';
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
		const line = `Opmerking ${issueNumber}  |  pagina ${marker.pageNumber}  |  ${getMarkerDisplayTitle(marker, issueNumber)}  |  ${getIssueCategoryLabel(marker.category)} / ${getIssueStatusLabel(marker.status)}`;

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

	issuePage.drawText(`Opmerking ${exportNumber}`, {
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
		`Planpagina ${marker.pageNumber}  |  ${marker.images.length} afbeelding${marker.images.length === 1 ? '' : 'en'}  |  opmerking ${exportNumber}  |  ${getIssueCategoryLabel(marker.category)} / ${getIssueStatusLabel(marker.status)} / ${getIssuePriorityLabel(marker.priority)}`,
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
	const label = `${target.exportNumber}`;
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
