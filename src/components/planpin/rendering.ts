const MAX_RENDER_PIXELS = 9_000_000;
const DEFAULT_RENDER_CACHE_LIMIT = 4;

export interface PdfRenderConfig {
	cacheKey: string;
	canvasHeight: number;
	canvasWidth: number;
	displayHeight: number;
	displayWidth: number;
	effectivePixelRatio: number;
	isResolutionCapped: boolean;
}

interface PdfRenderCacheEntry {
	canvas: HTMLCanvasElement;
}

export function getPdfRenderConfig({
	pageNumber,
	zoom,
	width,
	height,
	devicePixelRatio,
}: {
	pageNumber: number;
	zoom: number;
	width: number;
	height: number;
	devicePixelRatio: number;
}): PdfRenderConfig {
	const displayArea = Math.max(width * height, 1);
	const maxPixelRatio = Math.sqrt(MAX_RENDER_PIXELS / displayArea);
	const effectivePixelRatio = Math.min(devicePixelRatio, maxPixelRatio);
	const safePixelRatio = Number.isFinite(effectivePixelRatio) && effectivePixelRatio > 0
		? effectivePixelRatio
		: 1;

	return {
		cacheKey: `${pageNumber}:${zoom.toFixed(3)}:${safePixelRatio.toFixed(3)}`,
		canvasHeight: Math.max(1, Math.floor(height * safePixelRatio)),
		canvasWidth: Math.max(1, Math.floor(width * safePixelRatio)),
		displayHeight: height,
		displayWidth: width,
		effectivePixelRatio: safePixelRatio,
		isResolutionCapped: safePixelRatio < devicePixelRatio,
	};
}

export function createPdfRenderCache(limit = DEFAULT_RENDER_CACHE_LIMIT) {
	const entries = new Map<string, PdfRenderCacheEntry>();

	return {
		clear() {
			for (const { canvas } of entries.values()) {
				canvas.width = 0;
				canvas.height = 0;
			}

			entries.clear();
		},
		get(key: string) {
			const entry = entries.get(key);

			if (!entry) {
				return null;
			}

			entries.delete(key);
			entries.set(key, entry);

			return entry.canvas;
		},
		set(key: string, canvas: HTMLCanvasElement) {
			if (entries.has(key)) {
				entries.delete(key);
			}

			entries.set(key, { canvas });

			while (entries.size > limit) {
				const oldestKey = entries.keys().next().value;

				if (!oldestKey) {
					break;
				}

				const oldestEntry = entries.get(oldestKey);

				if (oldestEntry) {
					oldestEntry.canvas.width = 0;
					oldestEntry.canvas.height = 0;
				}

				entries.delete(oldestKey);
			}
		},
	};
}
