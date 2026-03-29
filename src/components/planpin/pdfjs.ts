import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import {
	PLANPIN_SOURCE_ATTACHMENT_NAME,
	readEmbeddedAttachment,
	readPlanPinManifest,
	restoreMarkersFromManifest,
} from './manifest';
import type { LoadedPdf } from './types';

type PdfJsModule = typeof import('pdfjs-dist');

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let workerConfigured = false;

async function getPdfJs(): Promise<PdfJsModule> {
	if (!pdfJsModulePromise) {
		pdfJsModulePromise = import('pdfjs-dist');
	}

	const pdfJs = await pdfJsModulePromise;

	if (!workerConfigured && typeof window !== 'undefined') {
		const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
		pdfJs.GlobalWorkerOptions.workerSrc = worker.default;
		workerConfigured = true;
	}

	return pdfJs;
}

export async function loadPdfDocument(file: File): Promise<LoadedPdf> {
	const arrayBuffer = await file.arrayBuffer();
	return loadPdfDocumentFromBytes({
		fileName: file.name,
		uploadedBytes: new Uint8Array(arrayBuffer.slice(0)),
	});
}

export async function loadPdfDocumentFromBytes({
	fileName,
	uploadedBytes,
	importedMarkersOverride,
	importedManifestOverride,
}: {
	fileName: string;
	uploadedBytes: Uint8Array;
	importedMarkersOverride?: LoadedPdf['importedMarkers'];
	importedManifestOverride?: LoadedPdf['importedManifest'];
}): Promise<LoadedPdf> {
	const pdfJs = await getPdfJs();
	let document: PDFDocumentProxy;
	const importedManifest =
		importedManifestOverride === undefined
			? await readPlanPinManifest(uploadedBytes)
			: importedManifestOverride;
	const embeddedSourceBytes = importedManifest
		? await readEmbeddedAttachment(uploadedBytes, PLANPIN_SOURCE_ATTACHMENT_NAME)
		: null;
	const sourceBytes = embeddedSourceBytes
		? new Uint8Array(embeddedSourceBytes.slice(0))
		: new Uint8Array(uploadedBytes.slice(0));
	const renderBytes = new Uint8Array(sourceBytes.slice(0));
	const importedMarkers =
		importedMarkersOverride ??
		(importedManifest ? await restoreMarkersFromManifest(importedManifest, uploadedBytes) : []);

	try {
		const loadingTask = pdfJs.getDocument({ data: renderBytes });
		document = await loadingTask.promise;
	} catch {
		// Local dev can fail to initialize the worker depending on the served base path.
		// Falling back keeps the client-side viewer usable without changing hosting setup.
		const loadingTask = pdfJs.getDocument({
			data: new Uint8Array(sourceBytes.slice(0)),
			disableWorker: true,
		});
		document = await loadingTask.promise;
	}

	return {
		document,
		fileName: importedManifest?.sourceFileName || fileName,
		sourceBytes,
		importedMarkers,
		importedManifest,
	};
}

export async function getPdfPage(
	document: PDFDocumentProxy,
	pageNumber: number,
): Promise<PDFPageProxy> {
	return document.getPage(pageNumber);
}
