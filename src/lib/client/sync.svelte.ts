import { MAX_PUSH } from '../core/protocol.ts';
import type { SyncResponse } from '../core/protocol.ts';
import { ApiError, OFFLINE, request } from './api.ts';
import { app } from './app.svelte.ts';
import { me } from './session.svelte.ts';

export type SyncStatus = 'idle' | 'offline' | 'signed-out' | 'other-account' | 'error';

export const sync = $state({ status: 'idle' as SyncStatus });

const DEBOUNCE_MS = 1500;
const ROUNDS = 10;

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let again = false;
let blocked = false;

export function scheduleSync(delay = DEBOUNCE_MS): void {
	clearTimeout(timer);
	timer = setTimeout(() => void syncNow(), delay);
}

async function exchange(): Promise<void> {
	for (let round = 0; round < ROUNDS; round += 1) {
		const push = app.dirtyRecords().slice(0, MAX_PUSH);
		const watermark = (await app.meta<number>('watermark')) ?? 0;

		const response = await request<SyncResponse>('/api/sync', {
			method: 'POST',
			body: { watermark, push }
		});

		app.settle(push, response.records);
		await app.setMeta('watermark', response.watermark);

		if (app.pending === 0) {
			return;
		}
	}
}

export async function syncNow(): Promise<void> {
	if (blocked || !me.account) {
		return;
	}
	if (running !== undefined) {
		again = true;
		return running;
	}

	running = (async () => {
		await app.load();
		do {
			again = false;
			try {
				await exchange();
				sync.status = 'idle';
			} catch (error) {
				if (!(error instanceof ApiError)) {
					sync.status = 'error';
					throw error;
				}
				if (error.status === 401) {
					me.account = null;
				}
				sync.status =
					error.status === OFFLINE ? 'offline' : error.status === 401 ? 'signed-out' : 'error';
				again = false;
			}
		} while (again);
	})().finally(() => {
		running = undefined;
	});

	return running;
}

/** A store filled under another account never syncs into this one. */
export async function claimOwner(userId: string): Promise<boolean> {
	const owner = await app.meta<string>('owner');

	if (owner === undefined) {
		await app.setMeta('owner', userId);
		return true;
	}

	if (owner === userId) {
		return true;
	}

	if (app.pending === 0) {
		await app.setMeta('owner', userId);
		await app.reset();
		return false;
	}

	blocked = true;
	sync.status = 'other-account';
	return false;
}

let started = false;

export function startSync(): void {
	if (started) {
		void syncNow();
		return;
	}
	started = true;

	app.onChange = () => scheduleSync();
	window.addEventListener('online', () => void syncNow());
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			void syncNow();
		}
	});
	setInterval(() => void syncNow(), 60_000);
	void syncNow();
}
