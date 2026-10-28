import type { Credential } from '#lib/server/auth/session.ts';

declare global {
	interface ImportMetaEnv {
		readonly APP_BUILD: boolean;
		readonly DEFAULT_SERVER: string;
		readonly APP_VERSION: string;
		readonly CHEAP_SCRYPT?: 'true';
	}

	namespace App {
		interface Locals {
			credential: Credential | null;
		}
	}
}

export {};
