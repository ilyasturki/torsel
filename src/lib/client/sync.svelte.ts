import { MAX_PUSH } from '../core/protocol.ts';
import type { SyncResponse } from '../core/protocol.ts';
import { ApiError, NO_SERVER, OFFLINE, deviceToken, request } from './api.ts';
import { app } from './app.svelte.ts';
import type { Account } from './auth.ts';
import { logout, session } from './auth.ts';
import { forgetAccount, me } from './session.svelte.ts';

export type SyncStatus = 'idle' | 'offline' | 'signed-out' | 'other-account' | 'error';

export const sync = $state({ status: 'idle' as SyncStatus });

const DEBOUNCE_MS = 1500;
const ROUNDS = 10;

// Apart from `owner`, which outlives a sign-out: the store's data stays bound to that account.
const SIGNED_IN = 'signedIn';

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

/** A store filled under another account never syncs into this one; a store with no owner joins it. */
export async function claimOwner(userId: string): Promise<boolean> {
	const owner = await app.meta<string>('owner');

	if (owner === undefined || owner === userId) {
		await app.setMeta('owner', userId);
		blocked = false;
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

async function findAccount(): Promise<Account | null | undefined> {
	if (import.meta.env.APP_BUILD && deviceToken() === null) {
		return null;
	}

	try {
		return await session();
	} catch (error) {
		if (!(error instanceof ApiError)) {
			throw error;
		}
		if (error.status === NO_SERVER) {
			return null;
		}
		if (await app.meta<boolean>(SIGNED_IN)) {
			sync.status = error.status === OFFLINE ? 'offline' : 'error';
		}
		window.addEventListener('online', () => void resolveSession(), { once: true });
		return undefined;
	}
}

async function settleSession(): Promise<void> {
	await app.load();

	const account = await findAccount();
	if (account === undefined) {
		return;
	}

	me.account = account;

	if (account === null) {
		if (await app.meta<boolean>(SIGNED_IN)) {
			sync.status = 'signed-out';
		}
		return;
	}

	await app.setMeta(SIGNED_IN, true);
	sync.status = 'idle';
	if (await claimOwner(account.id)) {
		startSync();
	}
}

let settling: Promise<void> | undefined;

export function resolveSession(): Promise<void> {
	settling ??= settleSession().finally(() => {
		settling = undefined;
	});
	return settling;
}

let channel: BroadcastChannel | undefined;

// Lazily: the server build imports this module, and an open channel would keep the process alive.
function tabs(): BroadcastChannel {
	channel ??= new BroadcastChannel('torsel-auth');
	return channel;
}

export function followOtherTabs(refresh: () => void): () => void {
	const listener = ({ data }: MessageEvent<'signed-in' | 'signed-out'>): void => {
		if (data === 'signed-out') {
			me.account = null;
			sync.status = 'idle';
		} else {
			forgetAccount();
			refresh();
		}
	};

	tabs().addEventListener('message', listener);
	return () => {
		tabs().removeEventListener('message', listener);
	};
}

export async function adoptSession(): Promise<void> {
	await settling;
	forgetAccount();
	await resolveSession();
	tabs().postMessage('signed-in');
}

/** False when the web server can't be told: a page can't clear its httpOnly session cookie. */
export async function signOut(): Promise<boolean> {
	try {
		await logout();
	} catch (error) {
		const gone = error instanceof ApiError && error.status === 401;
		if (!gone && !import.meta.env.APP_BUILD) {
			return false;
		}
	}

	await app.setMeta(SIGNED_IN, false);
	me.account = null;
	sync.status = 'idle';
	tabs().postMessage('signed-out');
	return true;
}

export async function eraseDevice(): Promise<void> {
	await app.setMeta(SIGNED_IN, false);
	await app.forgetOwner();
	await app.reset();
}
