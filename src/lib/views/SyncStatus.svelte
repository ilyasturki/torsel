<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { sync, syncNow } from '#lib/client/sync.svelte.ts';

	const action = 'underline';

	function retry(): void {
		void (me.account === undefined ? invalidateAll() : syncNow());
	}
</script>

{#if sync.status !== 'idle' && (sync.status !== 'offline' || app.pending > 0)}
	<p role="status" class="flex shrink-0 items-center gap-1 pt-1 font-medium">
		{#if sync.status === 'offline'}
			Offline, {app.pending} change{app.pending === 1 ? '' : 's'} waiting
		{:else if sync.status === 'signed-out'}
			Session expired,
			<a class={action} href="/app/login?to={encodeURIComponent(page.url.pathname + page.url.search)}"
				>sign in again</a
			>
		{:else if sync.status === 'error'}
			Sync failed,
			<button type="button" class={action} onclick={retry}>retry</button>
		{:else}
			This device holds another account’s data,
			<button type="button" class={action} onclick={() => void app.reset()}>erase it</button>
		{/if}
	</p>
{/if}
