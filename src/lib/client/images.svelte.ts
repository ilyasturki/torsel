import type { ImageRef, ImageType } from '../core/images.ts';
import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, isImageType } from '../core/images.ts';
import { UPLOAD_PART } from '../core/thread.ts';
import { images as words } from '../i18n/images.ts';
import { ApiError, request, requestBlob, sentence } from './api.ts';
import { app } from './app.svelte.ts';
import type { LocalDb } from './local.ts';
import { keepImage, readImage, readOutbox, sent } from './local.ts';
import { showToast } from './toast.svelte.ts';

// Readable for a receipt, and a poster's long side twice over.
const LONG_SIDE = 2048;

// Object URLs kept alive at once; the oldest is revoked past this.
const KEPT_URLS = 300;

/** Bumped when bytes may have arrived: an image shown as missing asks again. */
export const imageStore = $state({ version: 0 });

export class ImageProblem extends Error {}

async function sha256(blob: Blob): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const stem = (name: string): string => name.replace(/\.[^.]+$/u, '') || 'image';

function translucent(context: CanvasRenderingContext2D): boolean {
	const { data } = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
	for (let at = 3; at < data.length; at += 4) {
		if (data[at] < 255) return true;
	}
	return false;
}

/** A file as stored: downscaled, its metadata (a phone's GPS among it) dropped by re-encoding; a GIF stays as is so it still moves. */
export async function prepareImage(file: File): Promise<{ ref: ImageRef; blob: Blob }> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new ImageProblem(words.unreadable);
	}
	const { width, height } = bitmap;
	const name = file.name.trim() === '' ? undefined : file.name.trim();

	if (file.type === 'image/gif' && width * height <= MAX_IMAGE_PIXELS) {
		bitmap.close();
		if (file.size > MAX_IMAGE_BYTES) {
			throw new ImageProblem(words.tooBig);
		}
		const ref: ImageRef = {
			id: await sha256(file),
			type: 'image/gif',
			w: width,
			h: height,
			size: file.size
		};
		return { ref: name === undefined ? ref : { ...ref, name }, blob: file };
	}

	const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext('2d');
	context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();

	// PNG keeps transparency, which a JPEG paints black; an opaque image reads as well as a JPEG at a fraction of the bytes.
	const type: ImageType =
		file.type === 'image/png' ||
		(file.type !== 'image/jpeg' && context !== null && translucent(context))
			? 'image/png'
			: 'image/jpeg';
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
	if (blob === null) {
		throw new ImageProblem(words.unreadable);
	}
	if (blob.size > MAX_IMAGE_BYTES) {
		throw new ImageProblem(words.tooBig);
	}
	const ref: ImageRef = {
		id: await sha256(blob),
		type,
		w: canvas.width,
		h: canvas.height,
		size: blob.size
	};
	const extension = type === 'image/png' ? 'png' : 'jpg';
	return {
		ref: name === undefined ? ref : { ...ref, name: `${stem(name)}.${extension}` },
		blob: new Blob([blob], { type })
	};
}

async function local(): Promise<LocalDb> {
	const db = await app.store();
	if (db === undefined) {
		throw new ImageProblem(words.unreadable);
	}
	return db;
}

/** Each file as an image of `base`, kept here at once and queued for the server, up to a cell's room past the `held` it has; a file that can't be one is told and skipped. */
export async function addImages(base: string, files: File[], held: number): Promise<ImageRef[]> {
	const refs: ImageRef[] = [];
	for (const file of files) {
		if (held + refs.length >= MAX_IMAGES) break;
		try {
			const db = await local();
			const { ref, blob } = await prepareImage(file);
			await keepImage(db, ref, blob, base);
			remember(ref.id, blob);
			refs.push(ref);
		} catch (error) {
			if (!(error instanceof ImageProblem)) throw error;
			showToast(words.notKept(file.name || 'image', sentence(error.message)));
		}
	}
	return refs;
}

const urls = new Map<string, string>();

function remember(id: string, blob: Blob): string {
	const known = urls.get(id);
	if (known !== undefined) {
		urls.delete(id);
		urls.set(id, known);
		return known;
	}
	const url = URL.createObjectURL(blob);
	urls.set(id, url);
	if (urls.size > KEPT_URLS) {
		const [oldest, stale] = urls.entries().next().value as [string, string];
		urls.delete(oldest);
		URL.revokeObjectURL(stale);
	}
	return url;
}

const asking = new Map<string, Promise<string | null>>();

/** A URL showing the image, from this device or else the server; null while its bytes are nowhere to be had. */
export function imageUrl(base: string, ref: ImageRef): Promise<string | null> {
	const known = urls.get(ref.id);
	if (known !== undefined) {
		return Promise.resolve(known);
	}
	let pending = asking.get(ref.id);
	if (pending === undefined) {
		pending = fetchImage(base, ref).finally(() => asking.delete(ref.id));
		asking.set(ref.id, pending);
	}
	return pending;
}

async function fetchImage(base: string, ref: ImageRef): Promise<string | null> {
	const db = await app.store();
	const kept = db === undefined ? undefined : await readImage(db, ref.id);
	if (kept !== undefined) {
		return remember(ref.id, kept);
	}
	let blob: Blob;
	try {
		blob = await requestBlob(`/api/blobs/${base}/${ref.id}`);
	} catch (error) {
		if (error instanceof ApiError) return null;
		throw error;
	}
	// The type is the ref's, never the response's: the bytes only ever show as an image.
	const typed = new Blob([blob], { type: isImageType(ref.type) ? ref.type : 'image/jpeg' });
	if (db !== undefined) {
		await keepImage(db, ref, typed).catch(() => undefined);
	}
	return remember(ref.id, typed);
}

// Refusals that sending again won't change: the image stays on this device only.
const FINAL = new Set([400, 413, 415, 422, 507]);

/** Sends every image waiting here; stops at the first that can't go for now, leaving it and the rest queued. */
export async function flushOutbox(): Promise<void> {
	const db = await app.store();
	if (db === undefined) return;
	let flushed = false;
	for (const { base, ref, blob } of await readOutbox(db)) {
		try {
			for (let offset = 0; offset < blob.size; offset += UPLOAD_PART) {
				const bytes = new Uint8Array(await blob.slice(offset, offset + UPLOAD_PART).arrayBuffer());
				const query = new URLSearchParams({ size: String(blob.size), offset: String(offset) });
				const answer = await request<{ ref?: ImageRef }>(`/api/blobs/${base}/${ref.id}?${query}`, {
					method: 'POST',
					bytes
				});
				if (answer.ref !== undefined) break;
			}
		} catch (error) {
			if (!(error instanceof ApiError) || !FINAL.has(error.status)) throw error;
			showToast(words.notKept(ref.name ?? 'image', sentence(error.message)));
		}
		await sent(db, base, ref.id);
		flushed = true;
	}
	if (flushed) {
		imageStore.version += 1;
	}
}

/** After a sync: an image that was missing may be on the server now. */
export function retryMissing(): void {
	imageStore.version += 1;
}
