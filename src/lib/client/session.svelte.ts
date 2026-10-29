import type { Account } from './auth.ts';

export const me = $state({ account: undefined as Account | null | undefined });

export function forgetAccount(): void {
	me.account = undefined;
}
