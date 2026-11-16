import type { Value } from './model.ts';

export const IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif'
] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

/** One stored image: `id` is the sha-256 of its bytes, `w`/`h` lay it out before they arrive. */
export type ImageRef = {
	id: string;
	type: ImageType;
	w: number;
	h: number;
	size: number;
	name?: string;
	/** The URL it was fetched from, once, by the server. */
	src?: string;
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// A decompression bomb is small on the wire and huge once decoded: every device that shows it decodes it.
export const MAX_IMAGE_PIXELS = 40_000_000;

// Past this, a cell is a gallery: one push holds at most 400 KB.
export const MAX_IMAGES = 20;

const NAME_LENGTH = 200;

const SRC_LENGTH = 2048;

export const isImageSource = (url: unknown): url is string => {
	if (typeof url !== 'string' || url.length > SRC_LENGTH) return false;
	try {
		const { protocol } = new URL(url);
		return protocol === 'https:' || protocol === 'http:';
	} catch {
		return false;
	}
};

export const isBaseId = (id: string): boolean => /^b_[0-9a-z]{1,32}$/u.test(id);

export const isImageId = (id: unknown): id is string =>
	typeof id === 'string' && /^[0-9a-f]{64}$/u.test(id);

export const isImageType = (type: unknown): type is ImageType =>
	typeof type === 'string' && (IMAGE_TYPES as readonly string[]).includes(type);

const isDimension = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000;

/** The ref as stored, or null when any part of it is malformed. */
export function imageRef(raw: unknown): ImageRef | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return null;
	}
	const { id, type, w, h, size, name, src } = raw as Record<string, unknown>;
	if (
		!isImageId(id) ||
		!isImageType(type) ||
		!isDimension(w) ||
		!isDimension(h) ||
		w * h > MAX_IMAGE_PIXELS ||
		typeof size !== 'number' ||
		!Number.isInteger(size) ||
		size <= 0 ||
		size > MAX_IMAGE_BYTES
	) {
		return null;
	}
	const ref: ImageRef = { id, type, w, h, size };
	if (typeof name === 'string' && name.trim() !== '') {
		ref.name = name.trim().slice(0, NAME_LENGTH);
	}
	if (isImageSource(src)) {
		ref.src = src;
	}
	return ref;
}

/** A cell's images, the malformed ones dropped. */
export function imagesOf(value: Value | undefined): ImageRef[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: ImageRef[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const ref = imageRef(item);
		if (ref !== null && !seen.has(ref.id)) {
			seen.add(ref.id);
			out.push(ref);
		}
	}
	return out.slice(0, MAX_IMAGES);
}

export function imagesValue(refs: ImageRef[]): Value {
	return refs.length === 0 ? null : (refs.map((ref) => ({ ...ref })) as Value);
}

/** The links in a text value, each one an image to fetch: a bare domain reads as https. */
export function imageLinks(text: string): string[] {
	return text
		.split(/\s+|,(?=\s|https?:\/\/)/u)
		.map((part) => part.trim())
		.filter((part) => part !== '')
		.map((part) => (/^[a-z][a-z0-9+.-]*:/iu.test(part) ? part : `https://${part}`))
		.filter((part) => isImageSource(part) && /^https?:\/\/[^/\s]+\.[^/\s]+/iu.test(part));
}

/** What copy, CSV and a text field keep of a cell's images. */
export function imagesText(value: Value | undefined): string {
	return imagesOf(value)
		.map((ref) => ref.src ?? ref.name ?? ref.id.slice(0, 12))
		.join(', ');
}
