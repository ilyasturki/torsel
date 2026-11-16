<script lang="ts">
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { resolveSession, sync, syncNow } from '#lib/client/sync.svelte.ts';
	import { signInPath } from '#lib/core/return-path.ts';
	import Rich from '#lib/i18n/Rich.svelte';
	import { shell as words } from '#lib/i18n/shell.ts';

	const action = 'underline';

	function retryAll(): void {
		void (me.account === undefined ? resolveSession() : syncNow());
	}
</script>

{#if app.saveFailed || (sync.status !== 'idle' && (sync.status !== 'offline' || app.pending > 0))}
	<p
		role="status"
		class="flex shrink-0 items-center gap-1 font-medium max-lg:flex-wrap max-lg:pb-2"
	>
		{#if app.saveFailed}
			<Rich text={words.saveFailed}>
				{#snippet retry(label: string)}
					<button type="button" class={action} onclick={() => app.retrySave()}>{label}</button>
				{/snippet}
			</Rich>
		{:else if sync.status === 'offline'}
			{words.offline(app.pending)}
		{:else if sync.status === 'signed-out'}
			<Rich text={words.signedOut(app.pending)}>
				{#snippet signin(label: string)}
					<a class={action} href={signInPath(page.url.pathname + page.url.search)}>{label}</a>
				{/snippet}
			</Rich>
		{:else if sync.status === 'error'}
			<Rich text={words.syncFailed}>
				{#snippet retry(label: string)}
					<button type="button" class={action} onclick={retryAll}>{label}</button>
				{/snippet}
			</Rich>
		{:else}
			<Rich text={words.otherAccount}>
				{#snippet erase(label: string)}
					<button type="button" class={action} onclick={() => void app.reset()}>{label}</button>
				{/snippet}
			</Rich>
		{/if}
	</p>
{/if}
