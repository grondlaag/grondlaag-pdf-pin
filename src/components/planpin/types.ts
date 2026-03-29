import type { PDFDocumentProxy } from 'pdfjs-dist';

export const ISSUE_CATEGORY_OPTIONS = [
	'design',
	'technical',
	'site',
	'coordination',
	'safety',
	'other',
] as const;

export const ISSUE_STATUS_OPTIONS = ['open', 'in progress', 'resolved'] as const;

export const ISSUE_PRIORITY_OPTIONS = ['low', 'medium', 'high'] as const;

export type IssueCategory = (typeof ISSUE_CATEGORY_OPTIONS)[number];
export type IssueStatus = (typeof ISSUE_STATUS_OPTIONS)[number];
export type IssuePriority = (typeof ISSUE_PRIORITY_OPTIONS)[number];

export interface PageRenderSize {
	width: number;
	height: number;
	isResolutionCapped: boolean;
	effectivePixelRatio: number;
}

export interface OverlayPoint {
	x: number;
	y: number;
}

export interface IssueMarkerImage {
	id: string;
	name: string;
	type: string;
	size: number;
	file: File | null;
	previewUrl: string | null;
	source: 'upload' | 'manifest';
}

export interface IssueMarker {
	id: string;
	pageNumber: number;
	x: number;
	y: number;
	title: string;
	comment: string;
	category: IssueCategory;
	status: IssueStatus;
	priority: IssuePriority;
	reference: string;
	images: IssueMarkerImage[];
	createdAt: string;
}

export interface IssueMarkerDraft {
	id: string;
	pageNumber: number;
	x: number;
	y: number;
	title: string;
	comment: string;
	category: IssueCategory;
	status: IssueStatus;
	priority: IssuePriority;
	reference: string;
	images: IssueMarkerImage[];
	createdAt: string;
	mode: 'create' | 'edit';
}

export interface LoadedPdf {
	document: PDFDocumentProxy;
	fileName: string;
	sourceBytes: Uint8Array;
	importedMarkers: IssueMarker[];
	importedManifest: PlanPinManifest | null;
}

export interface PdfRenderTask {
	cancel: () => void;
	promise: Promise<unknown>;
}

export interface PlanPinManifestImage {
	id: string;
	name: string;
	type: string;
	size: number;
	attachmentName: string | null;
}

export interface PlanPinManifestIssue {
	id: string;
	pageNumber: number;
	x: number;
	y: number;
	title: string;
	comment: string;
	category: IssueCategory;
	status: IssueStatus;
	priority: IssuePriority;
	reference: string;
	createdAt: string;
	issueNumber: number;
	issuePageNumber: number;
	images: PlanPinManifestImage[];
}

export interface PlanPinManifestSession {
	id: string;
	label: string;
	createdAt: string;
}

export interface PlanPinManifest {
	kind: 'planpin-manifest';
	version: 1;
	sourceFileName: string;
	exportedAt: string;
	totalPlanPages: number;
	issues: PlanPinManifestIssue[];
	sessions: PlanPinManifestSession[];
}

export interface StoredIssueMarkerImage {
	id: string;
	name: string;
	type: string;
	size: number;
	file: Blob | null;
	source: IssueMarkerImage['source'];
}

export interface StoredIssueMarker {
	id: string;
	pageNumber: number;
	x: number;
	y: number;
	title: string;
	comment: string;
	category: IssueCategory;
	status: IssueStatus;
	priority: IssuePriority;
	reference: string;
	images: StoredIssueMarkerImage[];
	createdAt: string;
}

export interface PlanPinDraftSession {
	version: 1;
	savedAt: string;
	fileName: string;
	sourceBytes: ArrayBuffer;
	markers: StoredIssueMarker[];
	draftMarker: StoredIssueMarker | null;
	draftMode: IssueMarkerDraft['mode'] | null;
	selectedMarkerId: string | null;
	currentPage: number;
	zoom: number;
	fitMode: 'manual' | 'width' | 'height' | 'page';
}
