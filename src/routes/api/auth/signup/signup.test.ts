import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRateLimits } from '#lib/server/auth/rate-limit.ts';

import { POST } from './+server.ts';

function signUp() {
	return POST({
		request: new Request('http://torsel.test/api/auth/signup', {
			method: 'POST',
			body: JSON.stringify({ email: 'me@example.com', client: 'web' })
		}),
		cookies: {},
		url: new URL('http://torsel.test/api/auth/signup'),
		getClientAddress: () => '10.0.0.1'
	} as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	resetRateLimits();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('sign-up', () => {
	it.each([
		['absent', ''],
		['off', '0']
	])('is refused with the switch %s, closed by default', async (_name, value) => {
		vi.stubEnv('TORSEL_PUBLIC_SIGNUP', value);

		await expect(signUp()).rejects.toMatchObject({ status: 403 });
	});
});
