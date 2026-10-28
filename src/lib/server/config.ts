import { envText } from './env.ts';

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
