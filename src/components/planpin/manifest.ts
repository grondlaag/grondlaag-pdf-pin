import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFHexString,
	PDFName,
	PDFRawStream,
	PDFString,
} from 'pdf-lib';
import type {
	IssueMarker,
	IssueMarkerImage,
	PlanPinManifest,
	PlanPinManifestImage,
	PlanPinManifestIssue,
} from './types';

export const PLANPIN_MANIFEST_ATTACHMENT_NAME = 'planpin-manifest.json';
export const PLANPIN_MANIFEST_KEYWORD = 'planpin-manifest-v1';
export const PLANPIN_SOURCE_ATTACHMENT_NAME = 'planpin-source.pdf';
const PLANPIN_IMAGE_ATTACHMENT_PREFIX = 'planpin-images/';

function decodePdfText(value: unknown): string | null {
	if (value instanceof PDFHexString || value instanceof PDFString) {
		return value.decodeText();
	}

	return null;
}

async function inflateAttachmentBytes(bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof DecompressionStream === 'undefined') {
		throw new Error('Attachment decompression is unavailable in this browser.');
	}

	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
	const arrayBuffer = await new Response(stream).arrayBuffer();

	return new Uint8Array(arrayBuffer);
}

function createManifestImage(image: IssueMarkerImage): PlanPinManifestImage {
	return {
		id: image.id,
		name: image.name,
		type: image.type,
		size: image.size,
		attachmentName: image.file
			? createIssueImageAttachmentName({
					imageId: image.id,
					fileName: image.name,
				})
			: null,
	};
}

function sanitizeAttachmentSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

export function createIssueImageAttachmentName({
	imageId,
	fileName,
}: {
	imageId: string;
	fileName: string;
}): string {
	const safeFileName = sanitizeAttachmentSegment(fileName) || 'image';

	return `${PLANPIN_IMAGE_ATTACHMENT_PREFIX}${imageId}-${safeFileName}`;
}

export function createPlanPinManifest({
	fileName,
	totalPlanPages,
	markers,
	issuePageNumbers,
}: {
	fileName: string;
	totalPlanPages: number;
	markers: IssueMarker[];
	issuePageNumbers: Map<string, number>;
}): PlanPinManifest {
	return {
		kind: 'planpin-manifest',
		version: 1,
		sourceFileName: fileName,
		exportedAt: new Date().toISOString(),
		totalPlanPages,
		issues: markers.map((marker, index) => ({
			id: marker.id,
			pageNumber: marker.pageNumber,
			x: marker.x,
			y: marker.y,
			title: marker.title,
			comment: marker.comment,
			category: marker.category,
			status: marker.status,
			priority: marker.priority,
			reference: marker.reference,
			createdAt: marker.createdAt,
			issueNumber: index + 1,
			issuePageNumber: issuePageNumbers.get(marker.id) ?? totalPlanPages + index + 1,
			images: marker.images.map(createManifestImage),
		})),
		sessions: [],
	};
}

export function serializePlanPinManifest(manifest: PlanPinManifest): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}

function isManifestImage(value: unknown): value is PlanPinManifestImage {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.type === 'string' &&
		typeof candidate.size === 'number' &&
		(candidate.attachmentName === null || typeof candidate.attachmentName === 'string')
	);
}

function isManifestIssue(value: unknown): value is PlanPinManifestIssue {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (
		typeof candidate.id === 'string' &&
		typeof candidate.pageNumber === 'number' &&
		typeof candidate.x === 'number' &&
		typeof candidate.y === 'number' &&
		typeof candidate.title === 'string' &&
		typeof candidate.comment === 'string' &&
		typeof candidate.category === 'string' &&
		typeof candidate.status === 'string' &&
		typeof candidate.priority === 'string' &&
		typeof candidate.reference === 'string' &&
		typeof candidate.createdAt === 'string' &&
		typeof candidate.issueNumber === 'number' &&
		typeof candidate.issuePageNumber === 'number' &&
		Array.isArray(candidate.images) &&
		candidate.images.every(isManifestImage)
	);
}

function isPlanPinManifest(value: unknown): value is PlanPinManifest {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (
		candidate.kind === 'planpin-manifest' &&
		candidate.version === 1 &&
		typeof candidate.sourceFileName === 'string' &&
		typeof candidate.exportedAt === 'string' &&
		typeof candidate.totalPlanPages === 'number' &&
		Array.isArray(candidate.issues) &&
		candidate.issues.every(isManifestIssue) &&
		Array.isArray(candidate.sessions)
	);
}

async function extractAttachmentBytes(
	pdfDocument: PDFDocument,
	attachmentName: string,
): Promise<Uint8Array | null> {
	const names = pdfDocument.catalog.lookup(PDFName.of('Names'), PDFDict);

	if (!(names instanceof PDFDict)) {
		return null;
	}

	const embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);

	if (!(embeddedFiles instanceof PDFDict)) {
		return null;
	}

	const fileNames = embeddedFiles.lookup(PDFName.of('Names'), PDFArray);

	if (!(fileNames instanceof PDFArray)) {
		return null;
	}

	for (let index = 0; index < fileNames.size(); index += 2) {
		const nameObject = fileNames.lookup(index);
		const currentAttachmentName = decodePdfText(nameObject);

		if (currentAttachmentName !== attachmentName) {
			continue;
		}

		const fileSpec = fileNames.lookup(index + 1, PDFDict);

		if (!(fileSpec instanceof PDFDict)) {
			return null;
		}

		const embeddedFileEntry = fileSpec.lookup(PDFName.of('EF'), PDFDict);

		if (!(embeddedFileEntry instanceof PDFDict)) {
			return null;
		}

		const embeddedFileStream = embeddedFileEntry.lookup(PDFName.of('F'), PDFRawStream);

		if (!(embeddedFileStream instanceof PDFRawStream)) {
			return null;
		}

		const filter = embeddedFileStream.dict.lookup(PDFName.of('Filter'));
		const bytes = embeddedFileStream.getContents();

		if (filter instanceof PDFName && filter.decodeText() === 'FlateDecode') {
			return inflateAttachmentBytes(bytes);
		}

		return bytes;
	}

	return null;
}

export async function readEmbeddedAttachment(
	sourceBytes: Uint8Array,
	attachmentName: string,
): Promise<Uint8Array | null> {
	try {
		const pdfDocument = await PDFDocument.load(sourceBytes);

		return extractAttachmentBytes(pdfDocument, attachmentName);
	} catch {
		return null;
	}
}

async function extractAttachmentMap(
	pdfDocument: PDFDocument,
): Promise<Map<string, Uint8Array>> {
	const names = pdfDocument.catalog.lookup(PDFName.of('Names'), PDFDict);
	const attachments = new Map<string, Uint8Array>();

	if (!(names instanceof PDFDict)) {
		return attachments;
	}

	const embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);

	if (!(embeddedFiles instanceof PDFDict)) {
		return attachments;
	}

	const fileNames = embeddedFiles.lookup(PDFName.of('Names'), PDFArray);

	if (!(fileNames instanceof PDFArray)) {
		return attachments;
	}

	for (let index = 0; index < fileNames.size(); index += 2) {
		const nameObject = fileNames.lookup(index);
		const attachmentName = decodePdfText(nameObject);

		if (!attachmentName) {
			continue;
		}

		const fileSpec = fileNames.lookup(index + 1, PDFDict);

		if (!(fileSpec instanceof PDFDict)) {
			continue;
		}

		const embeddedFileEntry = fileSpec.lookup(PDFName.of('EF'), PDFDict);

		if (!(embeddedFileEntry instanceof PDFDict)) {
			continue;
		}

		const embeddedFileStream = embeddedFileEntry.lookup(PDFName.of('F'), PDFRawStream);

		if (!(embeddedFileStream instanceof PDFRawStream)) {
			continue;
		}

		const filter = embeddedFileStream.dict.lookup(PDFName.of('Filter'));
		const bytes = embeddedFileStream.getContents();

		if (filter instanceof PDFName && filter.decodeText() === 'FlateDecode') {
			attachments.set(attachmentName, await inflateAttachmentBytes(bytes));
			continue;
		}

		attachments.set(attachmentName, bytes);
	}

	return attachments;
}

export async function readPlanPinManifest(
	sourceBytes: Uint8Array,
): Promise<PlanPinManifest | null> {
	try {
		const pdfDocument = await PDFDocument.load(sourceBytes);
		const attachmentBytes = await extractAttachmentBytes(
			pdfDocument,
			PLANPIN_MANIFEST_ATTACHMENT_NAME,
		);

		if (!attachmentBytes) {
			return null;
		}

		const parsedValue = JSON.parse(new TextDecoder().decode(attachmentBytes)) as unknown;

		return isPlanPinManifest(parsedValue) ? parsedValue : null;
	} catch {
		return null;
	}
}

export function createImportedMarkerImages(
	images: PlanPinManifestImage[],
	attachments: Map<string, Uint8Array>,
): IssueMarkerImage[] {
	return images.map((image) => {
		const attachmentBytes =
			image.attachmentName ? attachments.get(image.attachmentName) ?? null : null;
		const file =
			attachmentBytes && image.type
				? new File([new Uint8Array(attachmentBytes)], image.name, { type: image.type })
				: null;

		return {
			id: image.id,
			name: image.name,
			type: image.type,
			size: image.size,
			file,
			previewUrl: file ? URL.createObjectURL(file) : null,
			source: 'manifest',
		};
	});
}

export async function restoreMarkersFromManifest(
	manifest: PlanPinManifest,
	sourceBytes: Uint8Array,
): Promise<IssueMarker[]> {
	const pdfDocument = await PDFDocument.load(sourceBytes);
	const attachments = await extractAttachmentMap(pdfDocument);

	return manifest.issues.map((issue) => ({
		id: issue.id,
		pageNumber: issue.pageNumber,
		x: issue.x,
		y: issue.y,
		title: issue.title,
		comment: issue.comment,
		category: issue.category,
		status: issue.status,
		priority: issue.priority,
		reference: issue.reference,
		images: createImportedMarkerImages(issue.images, attachments),
		createdAt: issue.createdAt,
	}));
}
