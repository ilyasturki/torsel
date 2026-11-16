import type { GoogleClient } from './auth/google.ts';
import { GOOGLE_PATH } from './auth/google.ts';
import { envAmount, envCount, envFlag, envText } from './env.ts';

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

/** Dollars of model use per rolling 24 hours, 0 for no cap; `unlimited` holds lowercased e-mails. */
export type AiLimits = { account: number; instance: number; unlimited: Set<string> };

// 30 typical first messages on Opus 5.5, about $0.11 each with their title and suggestions (measured Nov 16).
export const DAILY_BUDGET = 3.3;

let cachedLimits: { raw: string; limits: AiLimits } | undefined;

export function aiLimits(): AiLimits {
	const names = [
		'TORSEL_AI_DAILY_BUDGET',
		'TORSEL_AI_INSTANCE_DAILY_BUDGET',
		'TORSEL_AI_UNLIMITED'
	];
	const raw = names.map((name) => envText(name, '')).join('\n');

	if (cachedLimits === undefined || cachedLimits.raw !== raw) {
		cachedLimits = {
			raw,
			limits: {
				account: envAmount('TORSEL_AI_DAILY_BUDGET', DAILY_BUDGET),
				instance: envAmount('TORSEL_AI_INSTANCE_DAILY_BUDGET', DAILY_BUDGET * 10),
				unlimited: new Set(
					envText('TORSEL_AI_UNLIMITED', '')
						.toLowerCase()
						.split(/[\s,]+/u)
						.filter((email) => email !== '')
				)
			}
		};
	}

	return cachedLimits.limits;
}

/** MCP tool calls one credential may make per minute, 0 for no cap. */
export function mcpCallsPerMinute(): number {
	return envCount('TORSEL_MCP_CALLS_PER_MINUTE', 120);
}

/** REST API requests one credential may make per minute, 0 for no cap. */
export function apiCallsPerMinute(): number {
	return envCount('TORSEL_API_CALLS_PER_MINUTE', 300);
}

/** Bytes of images one account may keep, 0 for no cap. */
export function storageLimit(): number {
	return envCount('TORSEL_STORAGE_MB', 1024) * 1024 * 1024;
}

/** Rows one source fills a table with, and sources one account keeps; 0 lifts either cap. */
export function sourceLimits(): { rows: number; sources: number } {
	return {
		rows: envCount('TORSEL_SOURCE_ROWS', 5000) || Number.POSITIVE_INFINITY,
		sources: envCount('TORSEL_SOURCES', 20) || Number.POSITIVE_INFINITY
	};
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

// The MCP SDK refuses any other http issuer.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/** This server as an OAuth issuer: its pinned origin when served over https, or on loopback; else OAuth is off. */
export function oauthOrigin(url: URL): string | null {
	const origin = siteOrigin(url);
	if (origin === null) {
		return null;
	}
	const { protocol, hostname } = new URL(origin);
	return protocol === 'https:' || LOOPBACK_HOSTS.has(hostname) ? origin : null;
}

/** Server-side fetches of URLs a caller chose may reach loopback and private addresses. */
export function fetchesPrivate(): boolean {
	return envFlag('TORSEL_FETCH_PRIVATE');
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
