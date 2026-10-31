import { redirect } from '@sveltejs/kit';

import { app } from '#lib/client/app.svelte.ts';
import { LOGIN } from '#lib/client/nav.ts';
import { me } from '#lib/client/session.svelte.ts';
import { resolveSession } from '#lib/client/sync.svelte.ts';
import { returnTarget } from '#lib/core/return-path.ts';

import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ url }) => {
	await app.load();

	if (url.pathname === LOGIN) {
		if (me.account === undefined) {
			await resolveSession();
		}
		if (me.account) {
			redirect(307, returnTarget(url.searchParams.get('to')));
		}
	} else if (me.account === undefined && !url.pathname.startsWith(`${LOGIN}/`)) {
		void resolveSession();
	}
};
