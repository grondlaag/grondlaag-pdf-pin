import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PlanPinIssueModal from './PlanPinIssueModal';
import PlanPinIssueList from './PlanPinIssueList';
import PlanPinMiniMap from './PlanPinMiniMap';
import PlanPinMarkerLayer from './PlanPinMarkerLayer';
import { exportPlanPinCsv } from './export-csv';
import { exportPlanPinPdf } from './export-pdf';
import {
	getIssueCategoryLabel,
	getIssuePriorityLabel,
	getIssueStatusLabel,
} from './labels';
import {
	createDraftFromMarker,
	createDraftFromPoint,
	createMarkerFromDraft,
	getMarkerIssueNumber,
	getNewDraftImages,
	getRemovedMarkerImages,
	revokeMarkerImages,
} from './markers';
import { getPdfPage, loadPdfDocument, loadPdfDocumentFromBytes } from './pdfjs';
import { createPdfRenderCache, getPdfRenderConfig } from './rendering';
import {
	clearDraftSession,
	createDraftSession,
	loadDraftSession,
	restoreDraftSession,
	saveDraftSession,
} from './session-store';
import type {
	IssueCategory,
	IssueMarker,
	IssueMarkerDraft,
	IssueStatus,
	LoadedPdf,
	PageRenderSize,
	PlanPinDraftSession,
	PdfRenderTask,
} from './types';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const DEFAULT_ZOOM = 1;
const VIEWPORT_PADDING = 16;
const MARKER_FOCUS_ZOOM_MULTIPLIER = 4;
const MIN_MARKER_FOCUS_ZOOM = 1.6;
const MAX_MARKER_FOCUS_ZOOM = 3.25;
const MARKER_FOCUS_ZOOM_EPSILON = 0.01;

type FitMode = 'manual' | 'width' | 'height' | 'page';
type IssuePageFilter = 'all' | 'current' | number;
type IssueCategoryFilter = 'all' | IssueCategory;
type IssueStatusFilter = 'all' | IssueStatus;
type IssueSortOrder = 'page' | 'newest' | 'oldest';
type MarkerFocusRequest = {
	markerId: string;
	pageNumber: number;
	targetZoom: number;
	centerPoint: { x: number; y: number };
};
type IconName =
	| 'upload'
	| 'download'
	| 'chevronLeft'
	| 'chevronRight'
	| 'zoomIn'
	| 'zoomOut'
	| 'fitWidth'
	| 'fitHeight'
	| 'fitPage'
	| 'reset'
	| 'status';

const ICON_PATHS: Record<IconName, string> = {
	upload: 'M12 3v11m0-11 4 4m-4-4-4 4M5 15v4h14v-4',
	download: 'M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4',
	chevronLeft: 'M15 6l-6 6 6 6',
	chevronRight: 'M9 6l6 6-6 6',
	zoomIn: 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15 15l5 5M10.5 8v5M8 10.5h5',
	zoomOut: 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15 15l5 5M8 10.5h5',
	fitWidth: 'M4 8h16M4 16h16M7 5 4 8l3 3M17 5l3 3-3 3M7 13l-3 3 3 3M17 13l3 3-3 3',
	fitHeight: 'M8 4v16M16 4v16M5 7l3-3 3 3M5 17l3 3 3-3M13 7l3-3 3 3M13 17l3 3 3-3',
	fitPage: 'M7 3h10v18H7zM10 7h4M10 11h4M10 15h4',
	reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v6h6',
	status: 'M4 7h10M4 17h10M17 7h3M17 17h3M14 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM14 17a2 2 0 1 1 4 0 2 2 0 0 1-4 0z',
};

function Icon({ name }: { name: IconName }) {
	return (
		<svg className="planpin-app__icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d={ICON_PATHS[name]} />
		</svg>
	);
}

function clampZoom(value: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

async function getFitZoom({
	document,
	pageNumber,
	mode,
	viewportElement,
}: {
	document: PDFDocumentProxy;
	pageNumber: number;
	mode: Exclude<FitMode, 'manual'>;
	viewportElement: HTMLDivElement;
}): Promise<number | null> {
	const availableWidth = Math.max(0, viewportElement.clientWidth - VIEWPORT_PADDING * 2);
	const availableHeight = Math.max(0, viewportElement.clientHeight - VIEWPORT_PADDING * 2);

	if (availableWidth <= 0 || availableHeight <= 0) {
		return null;
	}

	const page = await getPdfPage(document, pageNumber);
	const baseViewport = page.getViewport({ scale: 1 });

	if (mode === 'width') {
		return clampZoom(availableWidth / Math.max(baseViewport.width, 1));
	}

	if (mode === 'height') {
		return clampZoom(availableHeight / Math.max(baseViewport.height, 1));
	}

	return clampZoom(
		Math.min(
			availableWidth / Math.max(baseViewport.width, 1),
			availableHeight / Math.max(baseViewport.height, 1),
		),
	);
}

export default function PlanPinApp() {
	const inputId = useId();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const renderCacheRef = useRef(createPdfRenderCache());
	const markersRef = useRef<IssueMarker[]>([]);
	const draftMarkerRef = useRef<IssueMarkerDraft | null>(null);
	const [loadedPdf, setLoadedPdf] = useState<LoadedPdf | null>(null);
	const [markers, setMarkers] = useState<IssueMarker[]>([]);
	const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
	const [draftMarker, setDraftMarker] = useState<IssueMarkerDraft | null>(null);
	const [currentPage, setCurrentPage] = useState(1);
	const [zoom, setZoom] = useState(DEFAULT_ZOOM);
	const [fitMode, setFitMode] = useState<FitMode>('width');
	const [issuePageFilter, setIssuePageFilter] = useState<IssuePageFilter>('all');
	const [issueCategoryFilter, setIssueCategoryFilter] = useState<IssueCategoryFilter>('all');
	const [issueStatusFilter, setIssueStatusFilter] = useState<IssueStatusFilter>('all');
	const [issueSortOrder, setIssueSortOrder] = useState<IssueSortOrder>('page');
	const [renderSize, setRenderSize] = useState<PageRenderSize | null>(null);
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	const [viewportScroll, setViewportScroll] = useState({ left: 0, top: 0 });
	const [isLoadingDocument, setIsLoadingDocument] = useState(false);
	const [isRenderingPage, setIsRenderingPage] = useState(false);
	const [isExportingPdf, setIsExportingPdf] = useState(false);
	const [isExportingCsv, setIsExportingCsv] = useState(false);
	const [availableDraftSession, setAvailableDraftSession] = useState<PlanPinDraftSession | null>(
		null,
	);
	const [isCheckingDraftSession, setIsCheckingDraftSession] = useState(true);
	const [isRestoringDraftSession, setIsRestoringDraftSession] = useState(false);
	const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
		'idle',
	);
	const [markerFocusVersion, setMarkerFocusVersion] = useState(0);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
	const markerFocusRequestRef = useRef<MarkerFocusRequest | null>(null);

	async function applyFitMode(mode: Exclude<FitMode, 'manual'>) {
		if (!loadedPdf || !viewportRef.current) {
			return;
		}

		const nextZoom = await getFitZoom({
			document: loadedPdf.document,
			pageNumber: currentPage,
			mode,
			viewportElement: viewportRef.current,
		});

		if (nextZoom === null) {
			return;
		}

		setFitMode(mode);
		setZoom(nextZoom);
	}

	function captureViewportAnchor() {
		const viewportElement = viewportRef.current;

		if (!viewportElement || !renderSize) {
			return;
		}

		zoomAnchorRef.current = {
			x:
				(viewportElement.scrollLeft + viewportElement.clientWidth / 2) /
				Math.max(renderSize.width, 1),
			y:
				(viewportElement.scrollTop + viewportElement.clientHeight / 2) /
				Math.max(renderSize.height, 1),
		};
	}

	function setManualZoom(nextZoom: number) {
		captureViewportAnchor();
		setFitMode('manual');
		setZoom(clampZoom(nextZoom));
	}

	function resetView() {
		void applyFitMode('width');
		viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
	}

	function navigateMiniMap(point: { x: number; y: number }) {
		const viewportElement = viewportRef.current;

		if (!viewportElement || !renderSize) {
			return;
		}

		const nextScrollLeft = Math.max(
			0,
			Math.min(
				renderSize.width - viewportElement.clientWidth,
				point.x * renderSize.width - viewportElement.clientWidth / 2,
			),
		);
		const nextScrollTop = Math.max(
			0,
			Math.min(
				renderSize.height - viewportElement.clientHeight,
				point.y * renderSize.height - viewportElement.clientHeight / 2,
			),
		);

		viewportElement.scrollTo({
			left: nextScrollLeft,
			top: nextScrollTop,
			behavior: 'smooth',
		});
	}

	useEffect(() => {
		renderCacheRef.current.clear();

		return () => {
			void loadedPdf?.document.destroy();
		};
	}, [loadedPdf]);

	useEffect(() => {
		markersRef.current = markers;
	}, [markers]);

	useEffect(() => {
		draftMarkerRef.current = draftMarker;
	}, [draftMarker]);

	useEffect(() => {
		return () => {
			for (const marker of markersRef.current) {
				revokeMarkerImages(marker.images);
			}
			if (draftMarkerRef.current) {
				revokeMarkerImages(draftMarkerRef.current.images);
			}
		};
	}, []);

	useEffect(() => {
		const viewportElement = viewportRef.current;

		if (!loadedPdf || !viewportElement) {
			setViewportSize({ width: 0, height: 0 });
			setViewportScroll({ left: 0, top: 0 });
			return;
		}

		const updateViewportState = () => {
			setViewportSize({
				width: Math.max(0, viewportElement.clientWidth - VIEWPORT_PADDING * 2),
				height: Math.max(0, viewportElement.clientHeight - VIEWPORT_PADDING * 2),
			});
			setViewportScroll({
				left: viewportElement.scrollLeft,
				top: viewportElement.scrollTop,
			});
		};

		const resizeObserver = new ResizeObserver(() => {
			updateViewportState();
		});

		resizeObserver.observe(viewportElement);
		viewportElement.addEventListener('scroll', updateViewportState, { passive: true });
		updateViewportState();

		return () => {
			resizeObserver.disconnect();
			viewportElement.removeEventListener('scroll', updateViewportState);
		};
	}, [loadedPdf]);

	useEffect(() => {
		if (!loadedPdf || fitMode === 'manual' || viewportSize.width <= 0 || viewportSize.height <= 0) {
			return;
		}

		void applyFitMode(fitMode);
	}, [currentPage, fitMode, loadedPdf, viewportSize.height, viewportSize.width]);

	useEffect(() => {
		if (!loadedPdf || !canvasRef.current) {
			return;
		}

		let cancelled = false;
		let renderTask: PdfRenderTask | null = null;

		async function renderPage(pdfDocument: PDFDocumentProxy) {
			try {
				setIsRenderingPage(true);
				setErrorMessage(null);

				const page = await getPdfPage(pdfDocument, currentPage);

				if (cancelled || !canvasRef.current) {
					return;
				}

				const viewport = page.getViewport({ scale: zoom });
				const canvas = canvasRef.current;
				const context = canvas.getContext('2d');

				if (!context) {
					throw new Error('Canvascontext is niet beschikbaar.');
				}

				const devicePixelRatio = window.devicePixelRatio || 1;
				const renderConfig = getPdfRenderConfig({
					pageNumber: currentPage,
					zoom,
					width: viewport.width,
					height: viewport.height,
					devicePixelRatio,
				});

				canvas.width = renderConfig.canvasWidth;
				canvas.height = renderConfig.canvasHeight;
				canvas.style.width = `${viewport.width}px`;
				canvas.style.height = `${viewport.height}px`;

				setRenderSize({
					width: viewport.width,
					height: viewport.height,
					isResolutionCapped: renderConfig.isResolutionCapped,
					effectivePixelRatio: renderConfig.effectivePixelRatio,
				});

				const cachedCanvas = renderCacheRef.current.get(renderConfig.cacheKey);

				if (cachedCanvas) {
					context.clearRect(0, 0, canvas.width, canvas.height);
					context.drawImage(cachedCanvas, 0, 0);
					return;
				}

				const offscreenCanvas = window.document.createElement('canvas');
				offscreenCanvas.width = renderConfig.canvasWidth;
				offscreenCanvas.height = renderConfig.canvasHeight;
				const offscreenContext = offscreenCanvas.getContext('2d');

				if (!offscreenContext) {
					throw new Error('Canvascontext is niet beschikbaar.');
				}

				renderTask = page.render({
					canvas: offscreenCanvas,
					canvasContext: offscreenContext,
					transform:
						renderConfig.effectivePixelRatio === 1
							? undefined
							: [
									renderConfig.effectivePixelRatio,
									0,
									0,
									renderConfig.effectivePixelRatio,
									0,
									0,
								],
					viewport,
				});

				await renderTask.promise;

				if (cancelled) {
					return;
				}

				renderCacheRef.current.set(renderConfig.cacheKey, offscreenCanvas);
				context.clearRect(0, 0, canvas.width, canvas.height);
				context.drawImage(offscreenCanvas, 0, 0);
			} catch (error) {
				if ((error as Error).name === 'RenderingCancelledException' || cancelled) {
					return;
				}

				setErrorMessage('De PDF-pagina kon niet worden weergegeven.');
			} finally {
				if (!cancelled) {
					setIsRenderingPage(false);
				}
			}
		}

		void renderPage(loadedPdf.document);

		return () => {
			cancelled = true;
			renderTask?.cancel();
		};
	}, [currentPage, loadedPdf, zoom]);

	useEffect(() => {
		const viewportElement = viewportRef.current;
		const anchor = zoomAnchorRef.current;

		if (!viewportElement || !renderSize || !anchor) {
			return;
		}

		const nextScrollLeft = Math.max(
			0,
			Math.min(
				renderSize.width - viewportElement.clientWidth,
				anchor.x * renderSize.width - viewportElement.clientWidth / 2,
			),
		);
		const nextScrollTop = Math.max(
			0,
			Math.min(
				renderSize.height - viewportElement.clientHeight,
				anchor.y * renderSize.height - viewportElement.clientHeight / 2,
			),
		);

		viewportElement.scrollTo({
			left: nextScrollLeft,
			top: nextScrollTop,
		});
		zoomAnchorRef.current = null;
	}, [renderSize]);

	useEffect(() => {
		const viewportElement = viewportRef.current;
		const focusRequest = markerFocusRequestRef.current;

		if (!viewportElement || !renderSize || !focusRequest || isRenderingPage) {
			return;
		}

		if (currentPage !== focusRequest.pageNumber) {
			return;
		}

		if (Math.abs(zoom - focusRequest.targetZoom) > MARKER_FOCUS_ZOOM_EPSILON) {
			return;
		}

		const nextScrollLeft = Math.max(
			0,
			Math.min(
				renderSize.width - viewportElement.clientWidth,
				focusRequest.centerPoint.x * renderSize.width - viewportElement.clientWidth / 2,
			),
		);
		const nextScrollTop = Math.max(
			0,
			Math.min(
				renderSize.height - viewportElement.clientHeight,
				focusRequest.centerPoint.y * renderSize.height - viewportElement.clientHeight / 2,
			),
		);

		viewportElement.scrollTo({
			left: nextScrollLeft,
			top: nextScrollTop,
			behavior: 'smooth',
		});
		markerFocusRequestRef.current = null;
	}, [currentPage, isRenderingPage, markerFocusVersion, renderSize, zoom]);

	useEffect(() => {
		const viewportElement = viewportRef.current;

		if (!viewportElement || markerFocusRequestRef.current) {
			return;
		}

		viewportElement.scrollTo({ left: 0, top: 0 });
	}, [currentPage]);

	useEffect(() => {
		let cancelled = false;

		async function readSavedDraft() {
			try {
				const nextDraftSession = await loadDraftSession();

				if (!cancelled) {
					setAvailableDraftSession(nextDraftSession);
				}
			} catch {
				if (!cancelled) {
					setAvailableDraftSession(null);
				}
			} finally {
				if (!cancelled) {
					setIsCheckingDraftSession(false);
				}
			}
		}

		void readSavedDraft();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!loadedPdf || isLoadingDocument || isRestoringDraftSession) {
			return;
		}

		setAutosaveStatus('saving');
		let cancelled = false;
		const timeoutId = window.setTimeout(() => {
			void (async () => {
				try {
					await saveDraftSession(
						createDraftSession({
							fileName: loadedPdf.fileName,
							sourceBytes: loadedPdf.sourceBytes,
							markers,
							draftMarker,
							selectedMarkerId,
							currentPage,
							zoom,
							fitMode,
						}),
					);

					if (!cancelled) {
						setAutosaveStatus('saved');
					}
				} catch {
					if (!cancelled) {
						setAutosaveStatus('error');
					}
				}
			})();
		}, 700);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [
		currentPage,
		draftMarker,
		fitMode,
		isLoadingDocument,
		isRestoringDraftSession,
		loadedPdf,
		markers,
		selectedMarkerId,
		zoom,
	]);

	useEffect(() => {
		if (!loadedPdf) {
			return;
		}

		const documentPageCount = loadedPdf.document.numPages;

		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target;

			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				draftMarkerRef.current
			) {
				return;
			}

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				setCurrentPage((value) => Math.max(1, value - 1));
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				setCurrentPage((value) => Math.min(documentPageCount, value + 1));
				return;
			}

			if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				setManualZoom(zoom + ZOOM_STEP);
				return;
			}

			if (event.key === '-') {
				event.preventDefault();
				setManualZoom(zoom - ZOOM_STEP);
				return;
			}

			if (event.key === '0') {
				event.preventDefault();
				setFitMode('manual');
				setZoom(DEFAULT_ZOOM);
				return;
			}

			if (event.key.toLowerCase() === 'f') {
				event.preventDefault();
				void applyFitMode('width');
				return;
			}

			if (event.key.toLowerCase() === 'h') {
				event.preventDefault();
				void applyFitMode('height');
				return;
			}

			if (event.key.toLowerCase() === 'p') {
				event.preventDefault();
				void applyFitMode('page');
				return;
			}

			if (event.key.toLowerCase() === 'r') {
				event.preventDefault();
				resetView();
			}
		}

		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [loadedPdf, zoom]);

	async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];

		if (!file) {
			return;
		}

		setIsLoadingDocument(true);
		setErrorMessage(null);
		setSelectedMarkerId(null);
		setDraftMarker((currentDraft) => {
			if (currentDraft) {
				revokeMarkerImages(currentDraft.images);
			}

			return null;
		});

		try {
			const nextLoadedPdf = await loadPdfDocument(file);
			const initialZoom =
				viewportRef.current &&
				(await getFitZoom({
					document: nextLoadedPdf.document,
					pageNumber: 1,
					mode: 'width',
					viewportElement: viewportRef.current,
				}));

			setLoadedPdf((previousValue) => {
				if (previousValue) {
					void previousValue.document.destroy();
				}

				return nextLoadedPdf;
			});
			setMarkers((currentMarkers) => {
				for (const marker of currentMarkers) {
					revokeMarkerImages(marker.images);
				}

				return nextLoadedPdf.importedMarkers;
			});
			setCurrentPage(1);
			setIssuePageFilter('all');
			setIssueCategoryFilter('all');
			setIssueStatusFilter('all');
			setIssueSortOrder('page');
			setFitMode('width');
			setZoom(initialZoom ?? DEFAULT_ZOOM);
			setAvailableDraftSession(null);
			setAutosaveStatus('saving');
		} catch {
			setLoadedPdf(null);
			setMarkers((currentMarkers) => {
				for (const marker of currentMarkers) {
					revokeMarkerImages(marker.images);
				}

				return [];
			});
			setRenderSize(null);
			setErrorMessage('Het geselecteerde bestand kon niet als PDF worden geopend.');
		} finally {
			setIsLoadingDocument(false);
			event.target.value = '';
		}
	}

	async function handleRestoreDraftSession() {
		if (!availableDraftSession) {
			return;
		}

		setIsRestoringDraftSession(true);
		setErrorMessage(null);

		try {
			const restoredSession = restoreDraftSession(availableDraftSession);
			const nextLoadedPdf = await loadPdfDocumentFromBytes({
				fileName: availableDraftSession.fileName,
				uploadedBytes: restoredSession.sourceBytes,
				importedMarkersOverride: restoredSession.markers,
				importedManifestOverride: null,
			});

			setLoadedPdf((previousValue) => {
				if (previousValue) {
					void previousValue.document.destroy();
				}

				return nextLoadedPdf;
			});
			setMarkers((currentMarkers) => {
				for (const marker of currentMarkers) {
					revokeMarkerImages(marker.images);
				}

				return restoredSession.markers;
			});
			setDraftMarker((currentDraft) => {
				closeDraft(currentDraft);
				return restoredSession.draftMarker;
			});
			setSelectedMarkerId(restoredSession.selectedMarkerId);
			setCurrentPage(
				Math.min(
					Math.max(1, restoredSession.currentPage),
					Math.max(1, nextLoadedPdf.document.numPages),
				),
			);
			setIssuePageFilter('all');
			setIssueCategoryFilter('all');
			setIssueStatusFilter('all');
			setIssueSortOrder('page');
			setFitMode(restoredSession.fitMode);
			setZoom(clampZoom(restoredSession.zoom));
			setAvailableDraftSession(null);
			setAutosaveStatus('saved');
		} catch {
			setErrorMessage('De opgeslagen werksessie kon niet worden hersteld.');
		} finally {
			setIsRestoringDraftSession(false);
		}
	}

	async function handleDiscardDraftSession() {
		try {
			await clearDraftSession();
			setAvailableDraftSession(null);
		} catch {
			setErrorMessage('De opgeslagen werksessie kon niet worden verwijderd.');
		}
	}

	const totalPages = loadedPdf?.document.numPages ?? 0;
	const visibleMarkers = markers.filter((marker) => marker.pageNumber === currentPage);
	const filteredMarkers = markers.filter((marker) => {
		const matchesPage =
			issuePageFilter === 'all'
				? true
				: issuePageFilter === 'current'
					? marker.pageNumber === currentPage
					: marker.pageNumber === issuePageFilter;
		const matchesCategory =
			issueCategoryFilter === 'all' ? true : marker.category === issueCategoryFilter;
		const matchesStatus =
			issueStatusFilter === 'all' ? true : marker.status === issueStatusFilter;

		return matchesPage && matchesCategory && matchesStatus;
	});
	const sortedMarkers = [...filteredMarkers].sort((leftMarker, rightMarker) => {
		if (issueSortOrder === 'newest') {
			return (
				new Date(rightMarker.createdAt).getTime() - new Date(leftMarker.createdAt).getTime()
			);
		}

		if (issueSortOrder === 'oldest') {
			return (
				new Date(leftMarker.createdAt).getTime() - new Date(rightMarker.createdAt).getTime()
			);
		}

		if (leftMarker.pageNumber !== rightMarker.pageNumber) {
			return leftMarker.pageNumber - rightMarker.pageNumber;
		}

		return (
			getMarkerIssueNumber(leftMarker.id, markers) - getMarkerIssueNumber(rightMarker.id, markers)
		);
	});
	const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
	const issueNumbers = Object.fromEntries(
		markers.map((marker) => [marker.id, getMarkerIssueNumber(marker.id, markers)]),
	);

	function closeDraft(currentDraft: IssueMarkerDraft | null) {
		if (!currentDraft) {
			return;
		}

		const originalMarker =
			currentDraft.mode === 'edit'
				? markersRef.current.find((marker) => marker.id === currentDraft.id) ?? null
				: null;

		revokeMarkerImages(
			currentDraft.mode === 'create'
				? currentDraft.images
				: getNewDraftImages({ draft: currentDraft, originalMarker }),
		);
	}

	function openCreateIssueDraft(pageNumber: number, point: { x: number; y: number }) {
		setDraftMarker((currentDraft) => {
			closeDraft(currentDraft);

			return createDraftFromPoint({
				pageNumber,
				point,
				issueNumber: markersRef.current.length + 1,
			});
		});
	}

	function openEditIssueDraft(markerId: string) {
		const marker = markersRef.current.find((currentMarker) => currentMarker.id === markerId);

		if (!marker) {
			return;
		}

		setSelectedMarkerId(markerId);
		setCurrentPage(marker.pageNumber);
		setDraftMarker((currentDraft) => {
			if (currentDraft?.id !== markerId) {
				closeDraft(currentDraft);
			}

			return createDraftFromMarker(marker);
		});
	}

	function focusMarkerOnPlan(markerId: string) {
		const marker = markersRef.current.find((currentMarker) => currentMarker.id === markerId);

		if (!marker) {
			return;
		}

		setSelectedMarkerId(markerId);
		setDraftMarker((currentDraft) => {
			if (currentDraft?.id !== markerId) {
				closeDraft(currentDraft);
				return null;
			}

			return currentDraft;
		});

		void (async () => {
			const widthZoom =
				loadedPdf && viewportRef.current
					? await getFitZoom({
							document: loadedPdf.document,
							pageNumber: marker.pageNumber,
							mode: 'width',
							viewportElement: viewportRef.current,
						})
					: DEFAULT_ZOOM;

			const nextZoom = clampZoom(
				Math.min(
					MAX_MARKER_FOCUS_ZOOM,
					Math.max(MIN_MARKER_FOCUS_ZOOM, (widthZoom ?? DEFAULT_ZOOM) * MARKER_FOCUS_ZOOM_MULTIPLIER),
				),
			);

			markerFocusRequestRef.current = {
				markerId,
				pageNumber: marker.pageNumber,
				targetZoom: nextZoom,
				centerPoint: { x: marker.x, y: marker.y },
			};
			setMarkerFocusVersion((value) => value + 1);
			zoomAnchorRef.current = { x: marker.x, y: marker.y };
			setCurrentPage(marker.pageNumber);
			setFitMode('manual');
			setZoom(nextZoom);
		})();
	}

	function deleteMarker(markerId: string) {
		const currentDraft = draftMarkerRef.current;

		if (currentDraft?.id === markerId) {
			const originalMarker =
				markersRef.current.find((marker) => marker.id === markerId) ?? null;
			revokeMarkerImages(getNewDraftImages({ draft: currentDraft, originalMarker }));
			setDraftMarker(null);
		}

		setMarkers((currentMarkers) => {
			const markerToDelete = currentMarkers.find((marker) => marker.id === markerId) ?? null;

			if (markerToDelete) {
				revokeMarkerImages(markerToDelete.images);
			}

			return currentMarkers.filter((marker) => marker.id !== markerId);
		});

		if (selectedMarkerId === markerId) {
			setSelectedMarkerId(null);
		}
	}

	function confirmDeleteMarker(markerId: string) {
		const marker = markersRef.current.find((currentMarker) => currentMarker.id === markerId);
		const issueNumber = marker ? getMarkerIssueNumber(marker.id, markersRef.current) : null;
		const markerLabel = issueNumber ? `opmerking ${issueNumber}` : 'deze opmerking';

		if (!window.confirm(`Ben je zeker dat je ${markerLabel} wilt verwijderen?`)) {
			return;
		}

		deleteMarker(markerId);
	}

	async function handleExportPdf() {
		if (!loadedPdf) {
			return;
		}

		setIsExportingPdf(true);
		setErrorMessage(null);

		try {
			const { bytes, downloadName } = await exportPlanPinPdf({
				fileName: loadedPdf.fileName,
				sourceBytes: loadedPdf.sourceBytes,
				markers,
			});
			const downloadBytes = new Uint8Array(bytes.byteLength);
			downloadBytes.set(bytes);
			const blob = new Blob([downloadBytes.buffer], { type: 'application/pdf' });
			const downloadUrl = URL.createObjectURL(blob);
			const link = document.createElement('a');

			link.href = downloadUrl;
			link.download = downloadName;
			link.click();
			URL.revokeObjectURL(downloadUrl);
		} catch {
			setErrorMessage('De PDF-export kon niet worden gemaakt.');
		} finally {
			setIsExportingPdf(false);
		}
	}

	function handleExportCsv() {
		if (!loadedPdf) {
			return;
		}

		setIsExportingCsv(true);
		setErrorMessage(null);

		try {
			const { csv, downloadName } = exportPlanPinCsv({
				fileName: loadedPdf.fileName,
				markers,
			});
			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
			const downloadUrl = URL.createObjectURL(blob);
			const link = document.createElement('a');

			link.href = downloadUrl;
			link.download = downloadName;
			link.click();
			URL.revokeObjectURL(downloadUrl);
		} catch {
			setErrorMessage('De CSV-export kon niet worden gemaakt.');
		} finally {
			setIsExportingCsv(false);
		}
	}

	const statusLabel = errorMessage
		? 'fout'
		: isLoadingDocument
			? 'pdf laden'
			: isRestoringDraftSession
				? 'werksessie herstellen'
				: isCheckingDraftSession
					? 'werksessie controleren'
			: isRenderingPage
				? 'pagina renderen'
				: loadedPdf
					? 'pdf klaar'
					: 'wachten op upload';

	return (
		<div className="planpin-app">
			<div className="planpin-app__topbar">
				<div className="planpin-app__meta">
					<p className="planpin-app__label">document</p>
					<p className="planpin-app__filename" title={loadedPdf?.fileName ?? 'nog geen pdf geselecteerd'}>
						{loadedPdf?.fileName ?? 'nog geen pdf geselecteerd'}
					</p>
				</div>
				<div className="planpin-app__topbar-actions">
					<label className="planpin-app__upload" htmlFor={inputId}>
						<Icon name="upload" />
						<span>openen</span>
						<input
							id={inputId}
							className="planpin-app__input"
							type="file"
							accept="application/pdf"
							onChange={handleFileChange}
						/>
					</label>
					<div className="planpin-app__topbar-actions-row">
						<button
							type="button"
							className="planpin-app__button planpin-app__button--secondary"
							onClick={handleExportCsv}
							disabled={!loadedPdf || isExportingCsv}
						>
							<Icon name="download" />
							<span>{isExportingCsv ? 'csv exporteren' : 'csv'}</span>
						</button>
						<button
							type="button"
							className="planpin-app__button"
							onClick={handleExportPdf}
							disabled={!loadedPdf || isExportingPdf}
						>
							<Icon name="download" />
							<span>{isExportingPdf ? 'pdf exporteren' : 'exporteren'}</span>
						</button>
					</div>
				</div>
			</div>

			<div className="planpin-app__toolbar">
				<div className="planpin-app__controls" aria-label="pdf bediening">
					<div className="planpin-app__control-group">
						<button
							type="button"
							className="planpin-app__icon-button"
							onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
							disabled={!loadedPdf || currentPage <= 1 || isRenderingPage}
							aria-label="vorige pagina"
							title="vorige"
						>
							<Icon name="chevronLeft" />
						</button>
						<p className="planpin-app__counter">
							pagina {totalPages ? currentPage : 0} / {totalPages}
						</p>
						<button
							type="button"
							className="planpin-app__icon-button"
							onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}
							disabled={!loadedPdf || currentPage >= totalPages || isRenderingPage}
							aria-label="volgende pagina"
							title="volgende"
						>
							<Icon name="chevronRight" />
						</button>
					</div>
					<div className="planpin-app__control-group">
						<button
							type="button"
							className="planpin-app__icon-button"
							onClick={() => {
								setManualZoom(zoom - ZOOM_STEP);
							}}
							disabled={!loadedPdf || zoom <= MIN_ZOOM || isRenderingPage}
							aria-label="uitzoomen"
							title="uitzoomen"
						>
							<Icon name="zoomOut" />
						</button>
						<p className="planpin-app__counter">{Math.round(zoom * 100)}%</p>
						<button
							type="button"
							className="planpin-app__icon-button"
							onClick={() => {
								setManualZoom(zoom + ZOOM_STEP);
							}}
							disabled={!loadedPdf || zoom >= MAX_ZOOM || isRenderingPage}
							aria-label="inzoomen"
							title="inzoomen"
						>
							<Icon name="zoomIn" />
						</button>
					</div>
					<div className="planpin-app__control-group planpin-app__control-group--modes">
						<button
							type="button"
							className={`planpin-app__icon-button${fitMode === 'width' ? ' is-active' : ''}`}
							onClick={() => {
								void applyFitMode('width');
							}}
							disabled={!loadedPdf || isRenderingPage}
							aria-label="pas breedte"
							title="pas breedte"
						>
							<Icon name="fitWidth" />
						</button>
						<button
							type="button"
							className={`planpin-app__icon-button${fitMode === 'height' ? ' is-active' : ''}`}
							onClick={() => {
								void applyFitMode('height');
							}}
							disabled={!loadedPdf || isRenderingPage}
							aria-label="pas hoogte"
							title="pas hoogte"
						>
							<Icon name="fitHeight" />
						</button>
						<button
							type="button"
							className={`planpin-app__icon-button${fitMode === 'page' ? ' is-active' : ''}`}
							onClick={() => {
								void applyFitMode('page');
							}}
							disabled={!loadedPdf || isRenderingPage}
							aria-label="pas pagina"
							title="pas pagina"
						>
							<Icon name="fitPage" />
						</button>
						<button
							type="button"
							className={`planpin-app__button planpin-app__button--secondary${fitMode === 'manual' && zoom === DEFAULT_ZOOM ? ' is-active' : ''}`}
							onClick={() => {
								setFitMode('manual');
								setZoom(DEFAULT_ZOOM);
							}}
							disabled={!loadedPdf || isRenderingPage}
						>
							100%
						</button>
						<button
							type="button"
							className="planpin-app__icon-button"
							onClick={resetView}
							disabled={!loadedPdf || isRenderingPage}
							aria-label="reset zicht"
							title="reset zicht"
						>
							<Icon name="reset" />
						</button>
					</div>
				</div>
			</div>

			{availableDraftSession ? (
				<div className="planpin-app__restore">
					<div className="planpin-app__restore-copy">
						<p className="planpin-app__label">opgeslagen werksessie</p>
						<p>
							Hervat <strong>{availableDraftSession.fileName}</strong> van{' '}
							{new Date(availableDraftSession.savedAt).toLocaleString()}.
						</p>
					</div>
					<div className="planpin-app__restore-actions">
						<button
							type="button"
							className="planpin-app__button planpin-app__button--secondary"
							onClick={handleDiscardDraftSession}
							disabled={isRestoringDraftSession}
						>
							verwijder
						</button>
						<button
							type="button"
							className="planpin-app__button"
							onClick={() => {
								void handleRestoreDraftSession();
							}}
							disabled={isRestoringDraftSession}
						>
							{isRestoringDraftSession ? 'werksessie herstellen' : 'werksessie hervatten'}
						</button>
					</div>
				</div>
			) : null}

			<div className="planpin-app__workspace">
				<div className="planpin-app__viewer">
					{loadedPdf ? (
						<div className="planpin-app__viewer-stage">
							<div ref={viewportRef} className="planpin-app__canvas-viewport">
								<div className="planpin-app__canvas-stage">
									<div
										className="planpin-app__canvas-wrap"
										style={
											renderSize
												? { width: `${renderSize.width}px`, height: `${renderSize.height}px` }
												: undefined
										}
									>
										<canvas ref={canvasRef} className="planpin-app__canvas" />
										<PlanPinMarkerLayer
											markers={visibleMarkers}
											issueNumbers={issueNumbers}
											selectedMarkerId={selectedMarkerId}
											onOverlayClick={(point) => {
												openCreateIssueDraft(currentPage, point);
											}}
											onMarkerSelect={openEditIssueDraft}
										/>
									</div>
								</div>
							</div>
							<PlanPinMiniMap
								renderSize={renderSize}
								viewportWidth={viewportSize.width}
								viewportHeight={viewportSize.height}
								scrollLeft={viewportScroll.left}
								scrollTop={viewportScroll.top}
								markers={visibleMarkers}
								selectedMarkerId={selectedMarkerId}
								onNavigate={navigateMiniMap}
							/>
						</div>
					) : (
						<div className="planpin-app__empty">
							<h2>open een plan</h2>
							<p>kies een pdf-plan en plaats daarna pins op het tekenblad.</p>
						</div>
					)}
				</div>

				<aside className="planpin-app__sidebar">
					<PlanPinIssueList
						markers={sortedMarkers}
						issueNumbers={issueNumbers}
						totalMarkers={markers.length}
						totalPages={totalPages}
						currentPage={currentPage}
						pageFilter={issuePageFilter}
						onPageFilterChange={setIssuePageFilter}
						categoryFilter={issueCategoryFilter}
						onCategoryFilterChange={setIssueCategoryFilter}
						statusFilter={issueStatusFilter}
						onStatusFilterChange={setIssueStatusFilter}
						sortOrder={issueSortOrder}
						onSortOrderChange={setIssueSortOrder}
						selectedMarkerId={selectedMarkerId}
						onIssueOpen={openEditIssueDraft}
						onIssueFocus={focusMarkerOnPlan}
						onIssueDelete={confirmDeleteMarker}
					/>

					<div className="planpin-app__panel">
						<div className="planpin-app__panel-header">
							<p className="planpin-app__label">documentinfo</p>
							<p className="planpin-app__coords">{loadedPdf ? `${totalPages} pagina's` : 'geen pdf'}</p>
						</div>
						<p className="planpin-app__coords">
							totaal markeringen: {markers.length} / markeringen op pagina: {visibleMarkers.length}
						</p>
						<p className="planpin-app__coords">
							weergave: {fitMode === 'width' ? 'breedte' : fitMode === 'height' ? 'hoogte' : fitMode === 'page' ? 'pagina' : 'handmatig'}
						</p>
						<p className="planpin-app__coords">
							autosave: {autosaveStatus === 'idle' ? 'inactief' : autosaveStatus === 'saving' ? 'opslaan' : autosaveStatus === 'saved' ? 'opgeslagen' : 'fout'}
						</p>
						<p className="planpin-app__coords">sneltoetsen: f / h / p / r / 0 / pijlen</p>
						{renderSize?.isResolutionCapped ? (
							<p className="planpin-app__coords">
								renderresolutie beperkt voor prestaties op {renderSize.effectivePixelRatio.toFixed(2)}x
							</p>
						) : null}
						{selectedMarker ? (
							<>
								<p className="planpin-app__coords">geselecteerd: {selectedMarker.title}</p>
								<p className="planpin-app__coords">
									{getIssueCategoryLabel(selectedMarker.category)} / {getIssueStatusLabel(selectedMarker.status)} / {getIssuePriorityLabel(selectedMarker.priority)}
									{selectedMarker.reference ? ` / ref. ${selectedMarker.reference}` : ''}
								</p>
								<p className="planpin-app__coords">
									pagina {selectedMarker.pageNumber} op {Math.round(selectedMarker.x * 100)}% /{' '}
									{Math.round(selectedMarker.y * 100)}%
								</p>
							</>
						) : (
							<p className="planpin-app__coords">Nog geen markering geselecteerd.</p>
						)}
						{loadedPdf?.importedManifest ? (
							<p className="planpin-app__coords">
								{loadedPdf.importedManifest.issues.length} opmerkingen hersteld uit het ingesloten PlanPin-manifest
							</p>
						) : null}
						{errorMessage ? <p className="planpin-app__error">{errorMessage}</p> : null}
					</div>
				</aside>
			</div>
			{draftMarker ? (
				<PlanPinIssueModal
					draft={draftMarker}
					onCancel={() => {
						closeDraft(draftMarker);
						setDraftMarker(null);
					}}
					onDelete={
						draftMarker.mode === 'edit'
							? () => {
									confirmDeleteMarker(draftMarker.id);
								}
							: null
					}
					onSave={(nextDraft) => {
						const originalMarker =
							nextDraft.mode === 'edit'
								? markers.find((marker) => marker.id === nextDraft.id) ?? null
								: null;
						const nextMarker = createMarkerFromDraft(nextDraft);

						if (originalMarker) {
							revokeMarkerImages(
								getRemovedMarkerImages({ nextDraft, originalMarker }),
							);
							setMarkers((currentMarkers) =>
								currentMarkers.map((marker) =>
									marker.id === nextMarker.id ? nextMarker : marker,
								),
							);
						} else {
							setMarkers((currentMarkers) => [...currentMarkers, nextMarker]);
						}

						setSelectedMarkerId(nextMarker.id);
						setDraftMarker(null);
					}}
				/>
			) : null}
			<div className="planpin-app__statusbar">
				<span>
					<Icon name="status" /> {statusLabel}
				</span>
				<span>{loadedPdf ? `pagina ${currentPage}/${totalPages}` : 'geen document'}</span>
				<span>{markers.length} opmerkingen</span>
				<span>
					autosave{' '}
					{autosaveStatus === 'idle'
						? 'inactief'
						: autosaveStatus === 'saving'
							? 'bezig'
							: autosaveStatus === 'saved'
								? 'bewaard'
								: 'fout'}
				</span>
			</div>
		</div>
	);
}
