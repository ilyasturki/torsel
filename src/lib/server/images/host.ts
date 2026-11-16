import { createHash } from 'node:crypto';

import type { ImageRef } from '../../core/images.ts';
import type { StoredFile } from '../agent/threads.ts';
import { storageLimit } from '../config.ts';
import type { Database } from '../db/client.ts';
import { IngestFailed, ingestImage } from './ingest.ts';
import { imageInfo, receiveImagePart } from './store.ts';

/** How the tools turn what the model names (a link, an attached file, a stored image's id) into images of a base. */
export type ImageHost = {
	fromUrl(baseId: string, url: string): Promise<ImageRef>;
	fromFile(baseId: string, ref: string): ImageRef | null;
	fromId(baseId: string, id: string): ImageRef | null;
};

export function imageHost(
	db: Database,
	userId: string,
	files: () => Map<string, StoredFile> = () => new Map()
): ImageHost {
	return {
		fromUrl: (baseId, url) => ingestImage(db, userId, baseId, url),
		fromFile(baseId, ref) {
			const all = files();
			const file = all.get(ref) ?? [...all.values()].find((candidate) => candidate.name === ref);
			if (file === undefined) return null;
			const id = createHash('sha256').update(file.data).digest('hex');
			const received = receiveImagePart(
				db,
				{ userId, baseId, id, size: file.data.length, offset: 0, bytes: file.data },
				storageLimit()
			);
			if (received.status !== 'stored') {
				throw new IngestFailed(
					received.status === 'refused' &&
						(received.reason === 'full' || received.reason === 'too-many-pixels')
						? received.reason
						: 'not-an-image'
				);
			}
			return { ...received.ref, name: file.name };
		},
		fromId: (baseId, id) => imageInfo(db, userId, baseId, id) ?? null
	};
}
