try {
	process.loadEnvFile('.env');
} catch {
	// No `.env` is the ordinary case in production, where the env is real.
}

export function envText(name: string, fallback: string): string {
	const value = (process.env[name] ?? '').trim();
	return value === '' ? fallback : value;
}

export function envFlag(name: string): boolean {
	return ['1', 'true', 'yes', 'on'].includes(envText(name, '').toLowerCase());
}

export function envCount(name: string, fallback: number): number {
	const raw = envText(name, '');
	if (raw === '') {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		console.warn(`${name}: ignoring "${raw}", not a whole number of at least zero`);
		return fallback;
	}
	return value;
}
