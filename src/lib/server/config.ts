import type { GoogleClient } from './auth/google.ts';
import { GOOGLE_PATH } from './auth/google.ts';
import { envFlag, envText } from './env.ts';

const CAPACITOR_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];

function toOrigin(entry: string): string | undefined {
	try {
		// A non-special scheme yields the origin string "null", which would match the
		// literal `Origin: null` a sandboxed iframe sends.
		const { origin } = new URL(entry);
		return origin === 'null' ? undefined : origin;
	} catch {
		return undefined;
	}
}

let cached: { raw: string; origins: string[] } | undefined;

export function allowedOrigins(): string[] {
	const raw = envText('CORS_ORIGINS', '');

	if (cached === undefined || cached.raw !== raw) {
		const configured: string[] = [];

		for (const entry of raw.split(/[\s,]+/u).filter((part) => part !== '')) {
			const origin = toOrigin(entry);

			if (origin === undefined) {
				console.warn(`CORS_ORIGINS: ignoring "${entry}", not an origin a browser can send`);
			} else {
				configured.push(origin);
			}
		}

		cached = { raw, origins: [...CAPACITOR_ORIGINS, ...configured] };
	}

	return cached.origins;
}

export function anthropicKey(): string | undefined {
	const key = envText('ANTHROPIC_API_KEY', '');
	return key === '' ? undefined : key;
}

export function brevoKey(): string | undefined {
	const key = envText('BREVO_API_KEY', '');
	return key === '' ? undefined : key;
}

export function emailSender(): { name: string; email: string } | undefined {
	const email = envText('TORSEL_EMAIL_FROM', '');
	return email === '' ? undefined : { name: envText('TORSEL_EMAIL_FROM_NAME', 'Torsel'), email };
}

export function emailDelivers(): boolean {
	return brevoKey() !== undefined && emailSender() !== undefined;
}

export function signUpOpen(): boolean {
	return envFlag('TORSEL_PUBLIC_SIGNUP');
}

/** Null in production without `ORIGIN`: the Host header would otherwise pick where an emailed link or an OAuth redirect points. */
export function siteOrigin(url: URL): string | null {
	const pinned = toOrigin(envText('ORIGIN', ''));
	if (pinned !== undefined) {
		return pinned;
	}

	return import.meta.env?.DEV === true ? url.origin : null;
}

export function googleClient(url: URL): GoogleClient | null {
	const id = envText('GOOGLE_CLIENT_ID', '');
	const secret = envText('GOOGLE_CLIENT_SECRET', '');
	const origin = siteOrigin(url);

	if (id === '' || secret === '' || origin === null) {
		return null;
	}

	return { id, secret, redirectUri: `${origin}${GOOGLE_PATH}` };
}
