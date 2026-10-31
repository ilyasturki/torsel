import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deliver, signInMail } from './email.ts';

const LINK = 'https://torsel.example/app/login/link?token=abc&to=%2Fapp';

beforeEach(() => {
	vi.stubEnv('BREVO_API_KEY', '');
	vi.stubEnv('TORSEL_EMAIL_FROM', '');
	vi.stubEnv('TORSEL_EMAIL_FROM_NAME', '');
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('deliver', () => {
	it('logs the link and code without a key, and calls nothing', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const delivery = await deliver(signInMail('me@example.com', 'login', LINK, '123456'));

		expect(delivery).toBe('logged');
		expect(fetchMock).not.toHaveBeenCalled();
		const [line] = info.mock.calls[0] as [string];
		expect(line).toContain('to me@example.com');
		expect(line).toContain(`(link: ${LINK})`);
		expect(line).toContain('(code: 123456)');
	});

	it('logs when a key has no sender rather than letting Brevo refuse it', async () => {
		vi.stubEnv('BREVO_API_KEY', 'key');
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

		expect(await deliver(signInMail('me@example.com', 'login', LINK, '123456'))).toBe('logged');
		expect(info.mock.calls[0][0]).toContain('TORSEL_EMAIL_FROM not set');
	});

	it('posts to Brevo with the sender from env, and logs no secret', async () => {
		vi.stubEnv('BREVO_API_KEY', 'key');
		vi.stubEnv('TORSEL_EMAIL_FROM', 'no-reply@torsel.example');
		const info = vi.spyOn(console, 'info');
		const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
		vi.stubGlobal('fetch', fetchMock);

		const delivery = await deliver(signInMail('me@example.com', 'verify', LINK, '123456'));

		expect(delivery).toBe('sent');
		expect(info).not.toHaveBeenCalled();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.brevo.com/v3/smtp/email');
		expect(new Headers(init.headers).get('api-key')).toBe('key');
		expect(JSON.parse(init.body as string)).toMatchObject({
			sender: { name: 'Torsel', email: 'no-reply@torsel.example' },
			to: [{ email: 'me@example.com' }],
			subject: 'Confirm your email for Torsel'
		});
	});

	it.each([
		['a refusal', async () => new Response('{}', { status: 401 })],
		[
			'a network error',
			async () => {
				throw new Error('down');
			}
		]
	])('reports %s as failed', async (_name, answer) => {
		vi.stubEnv('BREVO_API_KEY', 'key');
		vi.stubEnv('TORSEL_EMAIL_FROM', 'no-reply@torsel.example');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', vi.fn(answer));

		expect(await deliver(signInMail('me@example.com', 'login', LINK, '123456'))).toBe('failed');
	});
});

describe('signInMail', () => {
	it('escapes the link in the html', () => {
		const { html, text } = signInMail('me@example.com', 'login', LINK, '123456');

		expect(html).toContain('token=abc&amp;to=%2Fapp');
		expect(html).toContain('123 456');
		expect(text).toContain(LINK);
	});

	it('leaves the link out when the origin is unknown', () => {
		const mail = signInMail('me@example.com', 'login', null, '123456');

		expect(mail.link).toBeUndefined();
		expect(mail.html).not.toContain('<a ');
		expect(mail.text).toContain('123 456');
	});
});
