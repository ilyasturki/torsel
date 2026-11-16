import Anthropic from '@anthropic-ai/sdk';
import { json } from '@sveltejs/kit';

import { isId } from '#lib/core/ids.ts';
import { locale } from '#lib/i18n/runtime.ts';
import { suggest } from '#lib/server/agent/suggest.ts';
import { meterFor, usageRefusal } from '#lib/server/agent/quota.ts';
import { aiLimits, anthropicKey } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { loadWorkspace } from '#lib/server/db/records.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

const id = (value: unknown): string | null => (isId(value) ? value : null);

/** A hint, never a failure: anything that goes wrong answers with no suggestions. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);
	const body = await readJsonBody(request);
	const apiKey = anthropicKey();
	const table = id(body.table);
	const db = getDatabase();
	const limits = aiLimits();
	if (apiKey === undefined || table === null || usageRefusal(db, user, limits) !== null) {
		return json({ suggestions: [] });
	}
	const today =
		typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(body.today)
			? body.today
			: undefined;
	try {
		const suggestions = await suggest(
			new Anthropic({ apiKey }),
			loadWorkspace(db, user.id),
			user.id,
			{
				screen: 'table',
				base: null,
				table,
				view: id(body.view),
				rows: [],
				fields: [],
				...(today === undefined ? {} : { today })
			},
			locale(),
			meterFor(db, user, limits)
		);
		return json({ suggestions });
	} catch (thrown) {
		console.error('suggestions:', thrown instanceof Error ? thrown.message : thrown);
		return json({ suggestions: [] });
	}
};
