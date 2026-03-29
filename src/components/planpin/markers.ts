import type { MouseEvent } from 'react';
import type {
	IssueMarker,
	IssueMarkerDraft,
	IssueMarkerImage,
	OverlayPoint,
} from './types';

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function getNormalizedOverlayPoint(
	event: MouseEvent<HTMLButtonElement>,
): OverlayPoint {
	const bounds = event.currentTarget.getBoundingClientRect();

	return {
		x: clampUnit((event.clientX - bounds.left) / bounds.width),
		y: clampUnit((event.clientY - bounds.top) / bounds.height),
	};
}

export function createIssueMarker({
	pageNumber,
	point,
	issueNumber,
}: {
	pageNumber: number;
	point: OverlayPoint;
	issueNumber: number;
}): IssueMarker {
	return {
		id: crypto.randomUUID(),
		pageNumber,
		x: point.x,
		y: point.y,
		title: `opmerking ${issueNumber}`,
		comment: '',
		category: 'other',
		status: 'open',
		priority: 'medium',
		reference: '',
		images: [],
		createdAt: new Date().toISOString(),
	};
}

export function createDraftFromPoint({
	pageNumber,
	point,
	issueNumber,
}: {
	pageNumber: number;
	point: OverlayPoint;
	issueNumber: number;
}): IssueMarkerDraft {
	const marker = createIssueMarker({ pageNumber, point, issueNumber });

	return {
		...marker,
		mode: 'create',
	};
}

export function createDraftFromMarker(marker: IssueMarker): IssueMarkerDraft {
	return {
		...marker,
		images: [...marker.images],
		mode: 'edit',
	};
}

export function createMarkerFromDraft(draft: IssueMarkerDraft): IssueMarker {
	return {
		id: draft.id,
		pageNumber: draft.pageNumber,
		x: draft.x,
		y: draft.y,
		title: draft.title.trim() || 'opmerking zonder titel',
		comment: draft.comment.trim(),
		category: draft.category,
		status: draft.status,
		priority: draft.priority,
		reference: draft.reference.trim(),
		images: draft.images,
		createdAt: draft.createdAt,
	};
}

export function createMarkerImages(files: File[]): IssueMarkerImage[] {
	return files.map((file) => ({
		id: crypto.randomUUID(),
		name: file.name,
		type: file.type,
		size: file.size,
		file,
		source: 'upload',
		previewUrl: URL.createObjectURL(file),
	}));
}

export function revokeMarkerImages(images: IssueMarkerImage[]) {
	for (const image of images) {
		if (image.previewUrl) {
			URL.revokeObjectURL(image.previewUrl);
		}
	}
}

export function getNewDraftImages({
	draft,
	originalMarker,
}: {
	draft: IssueMarkerDraft;
	originalMarker: IssueMarker | null;
}): IssueMarkerImage[] {
	const originalIds = new Set(originalMarker?.images.map((image) => image.id) ?? []);

	return draft.images.filter((image) => !originalIds.has(image.id));
}

export function getRemovedMarkerImages({
	nextDraft,
	originalMarker,
}: {
	nextDraft: IssueMarkerDraft;
	originalMarker: IssueMarker | null;
}): IssueMarkerImage[] {
	if (!originalMarker) {
		return [];
	}

	const nextIds = new Set(nextDraft.images.map((image) => image.id));

	return originalMarker.images.filter((image) => !nextIds.has(image.id));
}

export function getMarkerShortId(markerId: string): string {
	return markerId.slice(0, 6);
}

export function getMarkerIssueNumber(markerId: string, markers: IssueMarker[]): number {
	return Math.max(
		1,
		markers.findIndex((marker) => marker.id === markerId) + 1,
	);
}

export function isDefaultIssueTitle(title: string): boolean {
	return /^(issue|opmerking)\s+\d+$/i.test(title.trim());
}

export function getMarkerDisplayTitle(marker: IssueMarker, issueNumber: number): string {
	if (isDefaultIssueTitle(marker.title)) {
		return `opmerking ${issueNumber}`;
	}

	return marker.title.trim() || `opmerking ${issueNumber}`;
}

export function getMarkerCommentPreview(comment: string): string {
	const normalizedComment = comment.trim().replace(/\s+/g, ' ');

	if (normalizedComment.length <= 96) {
		return normalizedComment;
	}

	return `${normalizedComment.slice(0, 93)}...`;
}
