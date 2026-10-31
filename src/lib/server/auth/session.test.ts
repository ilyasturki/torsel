import { afterEach, describe, expect, it, vi } from 'vitest';

import { secureCookies } from './session.ts';

describe('secureCookies', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('follows the request without an ORIGIN', () => {
		vi.stubEnv('ORIGIN', '');
		expect(secureCookies(new URL('https://torsel.test/api'))).toBe(true);
		expect(secureCookies(new URL('http://127.0.0.1:5173/api'))).toBe(false);
	});

	it('trusts ORIGIN over a request the adapter assumed to be https', () => {
		vi.stubEnv('ORIGIN', 'http://192.168.1.50:3000');
		expect(secureCookies(new URL('https://192.168.1.50:3000/api'))).toBe(false);
	});

	it('keeps the cookie secure when ORIGIN is https', () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		expect(secureCookies(new URL('https://torsel.test/api'))).toBe(true);
	});
});
