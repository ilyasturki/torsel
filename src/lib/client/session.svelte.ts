import type { Account } from './auth.ts';

export const me = $state({
	account: undefined as Account | null | undefined,
	// A server that never answers leaves `account` undefined for good; this says it had its chance.
	asked: false
});

export function forgetAccount(): void {
	me.account = undefined;
}
