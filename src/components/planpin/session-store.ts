import type {
	IssueMarker,
	IssueMarkerDraft,
	IssueMarkerImage,
	PlanPinDraftSession,
	StoredIssueMarker,
	StoredIssueMarkerImage,
} from './types';

const DATABASE_NAME = 'planpin';
const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';
const ACTIVE_DRAFT_KEY = 'active';

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

		request.onerror = () => {
			reject(request.error ?? new Error('IndexedDB could not be opened.'));
		};

		request.onupgradeneeded = () => {
			const database = request.result;

			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME);
			}
		};

		request.onsuccess = () => {
			resolve(request.result);
		};
	});
}

function withStore<T>(
	mode: IDBTransactionMode,
	callback: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
	return new Promise((resolve, reject) => {
		void openDatabase()
			.then((database) => {
				const transaction = database.transaction(STORE_NAME, mode);
				const store = transaction.objectStore(STORE_NAME);

				transaction.oncomplete = () => {
					database.close();
				};
				transaction.onerror = () => {
					database.close();
					reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
				};
				transaction.onabort = () => {
					database.close();
					reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
				};

				callback(store, resolve, reject);
			})
			.catch(reject);
	});
}

function serializeImage(image: IssueMarkerImage): StoredIssueMarkerImage {
	return {
		id: image.id,
		name: image.name,
		type: image.type,
		size: image.size,
		file: image.file,
		source: image.source,
	};
}

function serializeMarker(marker: IssueMarker | IssueMarkerDraft): StoredIssueMarker {
	return {
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
		images: marker.images.map(serializeImage),
		createdAt: marker.createdAt,
	};
}

function createFileFromStoredImage(image: StoredIssueMarkerImage): File | null {
	if (!image.file) {
		return null;
	}

	if (image.file instanceof File) {
		return image.file;
	}

	return new File([image.file], image.name, {
		type: image.type,
		lastModified: Date.now(),
	});
}

function restoreImage(image: StoredIssueMarkerImage): IssueMarkerImage {
	const file = createFileFromStoredImage(image);

	return {
		id: image.id,
		name: image.name,
		type: image.type,
		size: image.size,
		file,
		previewUrl: file ? URL.createObjectURL(file) : null,
		source: image.source,
	};
}

function restoreMarker(marker: StoredIssueMarker): IssueMarker {
	return {
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
		images: marker.images.map(restoreImage),
		createdAt: marker.createdAt,
	};
}

export function createDraftSession({
	fileName,
	sourceBytes,
	markers,
	draftMarker,
	selectedMarkerId,
	currentPage,
	zoom,
	fitMode,
}: {
	fileName: string;
	sourceBytes: Uint8Array;
	markers: IssueMarker[];
	draftMarker: IssueMarkerDraft | null;
	selectedMarkerId: string | null;
	currentPage: number;
	zoom: number;
	fitMode: PlanPinDraftSession['fitMode'];
}): PlanPinDraftSession {
	const copiedBytes = new Uint8Array(sourceBytes.byteLength);
	copiedBytes.set(sourceBytes);

	return {
		version: 1,
		savedAt: new Date().toISOString(),
		fileName,
		sourceBytes: copiedBytes.buffer,
		markers: markers.map(serializeMarker),
		draftMarker: draftMarker ? serializeMarker(draftMarker) : null,
		draftMode: draftMarker?.mode ?? null,
		selectedMarkerId,
		currentPage,
		zoom,
		fitMode,
	};
}

export async function saveDraftSession(session: PlanPinDraftSession): Promise<void> {
	await withStore<void>('readwrite', (store, resolve, reject) => {
		const request = store.put(session, ACTIVE_DRAFT_KEY);

		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error('Draft session could not be saved.'));
	});
}

export async function loadDraftSession(): Promise<PlanPinDraftSession | null> {
	return withStore<PlanPinDraftSession | null>('readonly', (store, resolve, reject) => {
		const request = store.get(ACTIVE_DRAFT_KEY);

		request.onsuccess = () => {
			resolve((request.result as PlanPinDraftSession | undefined) ?? null);
		};
		request.onerror = () => reject(request.error ?? new Error('Draft session could not be read.'));
	});
}

export async function clearDraftSession(): Promise<void> {
	await withStore<void>('readwrite', (store, resolve, reject) => {
		const request = store.delete(ACTIVE_DRAFT_KEY);

		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error('Draft session could not be cleared.'));
	});
}

export function restoreDraftSession(session: PlanPinDraftSession): {
	sourceBytes: Uint8Array;
	markers: IssueMarker[];
	draftMarker: IssueMarkerDraft | null;
	selectedMarkerId: string | null;
	currentPage: number;
	zoom: number;
	fitMode: PlanPinDraftSession['fitMode'];
} {
	const sourceBytes = new Uint8Array(session.sourceBytes.slice(0));
	const markers = session.markers.map(restoreMarker);
	const draftMarker =
		session.draftMarker && session.draftMode
			? {
					...restoreMarker(session.draftMarker),
					mode: session.draftMode,
				}
			: null;

	return {
		sourceBytes,
		markers,
		draftMarker,
		selectedMarkerId: session.selectedMarkerId,
		currentPage: session.currentPage,
		zoom: session.zoom,
		fitMode: session.fitMode,
	};
}
