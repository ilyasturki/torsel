<script lang="ts">
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { resolveSession, sync, syncNow } from '#lib/client/sync.svelte.ts';
	import { signInPath } from '#lib/core/return-path.ts';

	const action = 'underline';

	function retry(): void {
		void (me.account === undefined ? resolveSession() : syncNow());
	}
</script>

{#if sync.status !== 'idle' && (sync.status !== 'offline' || app.pending > 0)}
	<p
		role="status"
		class="flex shrink-0 items-center gap-1 pt-1 font-medium max-lg:order-last max-lg:basis-full max-lg:flex-wrap"
	>
		{#if sync.status === 'offline'}
			Offline, {app.pending} change{app.pending === 1 ? '' : 's'} waiting
		{:else if sync.status === 'signed-out'}
			Session expired, {app.pending === 0
				? 'your data stays here,'
				: `${app.pending} waiting edit${app.pending === 1 ? ' stays' : 's stay'} here until you`}
			<a class={action} href={signInPath(page.url.pathname + page.url.search)}>sign in again</a>
		{:else if sync.status === 'error'}
			Sync failed,
			<button type="button" class={action} onclick={retry}>retry</button>
		{:else}
			This device holds another account’s data,
			<button type="button" class={action} onclick={() => void app.reset()}>erase it</button>
		{/if}
	</p>
{/if}
