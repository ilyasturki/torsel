import { describe, expect, it } from 'vitest';

import { returnPath, returnTarget, signInPath } from './return-path.ts';

describe('returnPath', () => {
	it.each([
		'/app',
		'/app/',
		'/app/settings',
		'/app/t/abc?v=def',
		'/app?x=1',
		'/app#top',
		'/app/t/a%20b'
	])('lets %s through', (path) => {
		expect(returnPath(path)).toBe(path);
	});

	it.each([
		['another host', 'https://evil.com/app'],
		['protocol-relative', '//evil.com/app'],
		['the backslash destination() let through', '/\\evil.com'],
		['a backslash inside the app', '/app\\..\\..\\evil.com'],
		['a sibling path', '/application'],
		['the landing', '/'],
		['a dot segment out', '/app/../evil'],
		['a bare dot segment', '/app/./settings'],
		['an encoded slash', '/app%2f..%2fevil'],
		['an encoded backslash', '/app/%5cevil'],
		['an encoded dot', '/app/%2e%2e/evil'],
		['a tab', '/app/\tevil'],
		['a newline', '/app/\nevil'],
		['a space', '/app/ evil'],
		['the sign-in page', '/app/login'],
		['the sign-in page with a query', '/app/login?to=/app'],
		['the link landing', '/app/login/link?token=x'],
		['a javascript url', 'javascript:alert(1)'],
		['an empty string', ''],
		['too long', `/app/${'a'.repeat(2000)}`]
	])('refuses %s', (_name, path) => {
		expect(returnPath(path)).toBeNull();
	});

	it.each([[undefined], [null], [42], [['/app']], [{}]])('refuses a non-string: %j', (value) => {
		expect(returnPath(value)).toBeNull();
	});
});

describe('returnTarget', () => {
	it('falls back to the app', () => {
		expect(returnTarget('/\\evil.com')).toBe('/app');
		expect(returnTarget(null)).toBe('/app');
		expect(returnTarget('/app/settings')).toBe('/app/settings');
	});
});

describe('signInPath', () => {
	it('carries a valid return path and drops any other', () => {
		expect(signInPath('/app/t/a?v=b')).toBe('/app/login?to=%2Fapp%2Ft%2Fa%3Fv%3Db');
		expect(signInPath('/\\evil.com')).toBe('/app/login');
		expect(signInPath(null)).toBe('/app/login');
	});
});
