// Past this many pixels on its long side an image costs the model more and tells it nothing new.
const LONG_SIDE = 1568;

const SHRUNK = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** A photo as the model reads it best: its long side down to `LONG_SIDE`, as a JPEG. */
export async function shrinkImage(file: File): Promise<File> {
	if (!SHRUNK.has(file.type) && !file.type.startsWith('image/heic')) {
		return file;
	}
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return file;
	}
	const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
	if (scale === 1 && SHRUNK.has(file.type) && file.size < 1_000_000) {
		bitmap.close();
		return file;
	}
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/jpeg', 0.85)
	);
	return blob === null
		? file
		: new File([blob], file.name.replace(/\.[^.]+$/u, '') + '.jpg', { type: 'image/jpeg' });
}
