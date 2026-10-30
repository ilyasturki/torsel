import { redirect } from '@sveltejs/kit';

import { invalidateAll } from '$app/navigation';

import { ApiError, NO_SERVER, OFFLINE, deviceToken } from '#lib/client/api.ts';
import { app } from '#lib/client/app.svelte.ts';
import type { Account } from '#lib/client/auth.ts';
import { session } from '#lib/client/auth.ts';
import { me } from '#lib/client/session.svelte.ts';
import { claimOwner, startSync, sync } from '#lib/client/sync.svelte.ts';

import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ url }) => {
	await app.load();

	if (url.pathname === '/login') {
		return { account: null };
	}

	if (me.account === undefined) {
		let account: Account | null = null;
		if (!import.meta.env.APP_BUILD || deviceToken() !== null) {
			try {
				account = await session();
			} catch (error) {
				if (!(error instanceof ApiError)) {
					throw error;
				}
				if (error.status === 401) {
					if (!import.meta.env.APP_BUILD) {
						redirect(307, `/login?to=${encodeURIComponent(url.pathname + url.search)}`);
					}
					sync.status = 'signed-out';
				} else if (error.status !== NO_SERVER) {
					sync.status = error.status === OFFLINE ? 'offline' : 'error';
					window.addEventListener('online', () => void invalidateAll(), { once: true });
					return { account: null };
				}
			}
		}
		me.account = account;

		if (account !== null && (await claimOwner(account.id))) {
			startSync();
		}
	}

	return { account: me.account };
};
