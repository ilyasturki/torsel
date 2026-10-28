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
