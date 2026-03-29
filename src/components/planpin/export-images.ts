import type { IssueMarkerImage } from './types';

const MAX_EXPORT_IMAGE_DIMENSION = 2200;
const MAX_EXPORT_IMAGE_BYTES = 2_500_000;

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
	return blob.arrayBuffer().then((arrayBuffer) => new Uint8Array(arrayBuffer));
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();

		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Image loading failed.'));
		image.src = url;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.82 : undefined);
	});
}

export async function getExportableImageBytes(
	image: IssueMarkerImage,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
	if (!image.file) {
		return null;
	}

	const mimeType =
		image.type === 'image/png' || image.type === 'image/jpeg' || image.type === 'image/jpg'
			? image.type === 'image/jpg'
				? 'image/jpeg'
				: image.type
			: null;

	if (!mimeType) {
		return null;
	}

	if (image.file.size <= MAX_EXPORT_IMAGE_BYTES) {
		return {
			bytes: new Uint8Array(await image.file.arrayBuffer()),
			mimeType,
		};
	}

	const objectUrl = URL.createObjectURL(image.file);

	try {
		const loadedImage = await loadImage(objectUrl);
		const maxDimension = Math.max(loadedImage.width, loadedImage.height);
		const scale = Math.min(1, MAX_EXPORT_IMAGE_DIMENSION / Math.max(maxDimension, 1));

		if (scale >= 1) {
			return {
				bytes: new Uint8Array(await image.file.arrayBuffer()),
				mimeType,
			};
		}

		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(loadedImage.width * scale));
		canvas.height = Math.max(1, Math.round(loadedImage.height * scale));

		const context = canvas.getContext('2d');

		if (!context) {
			return {
				bytes: new Uint8Array(await image.file.arrayBuffer()),
				mimeType,
			};
		}

		context.drawImage(loadedImage, 0, 0, canvas.width, canvas.height);

		const blob = await canvasToBlob(canvas, mimeType);

		if (!blob) {
			return {
				bytes: new Uint8Array(await image.file.arrayBuffer()),
				mimeType,
			};
		}

		return {
			bytes: await blobToUint8Array(blob),
			mimeType: blob.type || mimeType,
		};
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}
