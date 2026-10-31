import { describe, expect, it } from 'vitest';

import { POST } from './+server.ts';

describe('setting a password', () => {
	it('refuses an API token', async () => {
		const attempt = POST({
			request: new Request('http://torsel.test/api/auth/password', {
				method: 'POST',
				body: JSON.stringify({ password: 'correct horse battery' })
			}),
			locals: { credential: { user: { id: 'u1' }, token: { id: 't1', kind: 'api' } } }
		} as unknown as Parameters<typeof POST>[0]);

		await expect(attempt).rejects.toMatchObject({ status: 403 });
	});
});
