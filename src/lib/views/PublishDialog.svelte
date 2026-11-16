<script lang="ts">
	import { ApiError, apiBase, request } from '#lib/client/api.ts';
	import { syncNow } from '#lib/client/sync.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import type { ViewDef } from '#lib/core/model.ts';
	import { publish as words } from '#lib/i18n/publish.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { input } from '#lib/ui/styles.ts';

	let { open = $bindable(false), view }: { open?: boolean; view: ViewDef } = $props();

	let token = $state<string | null>(null);
	let loaded = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	const link = $derived(token === null ? '' : `${apiBase() ?? ''}/v/${token}`);

	$effect(() => {
		if (!open) return;
		const id = view.id;
		loaded = false;
		problem = null;
		void request<{ view: string; token: string }[]>('/api/publications').then(
			(listed) => {
				token = listed.find((item) => item.view === id)?.token ?? null;
				loaded = true;
			},
			() => {
				problem = words.failed;
			}
		);
	});

	async function run(action: () => Promise<void>): Promise<void> {
		busy = true;
		problem = null;
		try {
			await action();
		} catch (error) {
			problem = error instanceof ApiError && error.status === 404 ? words.notSynced : words.failed;
		} finally {
			busy = false;
		}
	}

	const publishView = () =>
		run(async () => {
			await syncNow();
			const made = await request<{ token: string }>('/api/publications', {
				method: 'POST',
				body: { view: view.id }
			});
			token = made.token;
		});

	const unpublish = () =>
		run(async () => {
			await request(`/api/publications/${view.id}`, { method: 'DELETE' });
			token = null;
			open = false;
			showToast(words.unpublished(view.name));
		});

	async function copy(): Promise<void> {
		await navigator.clipboard.writeText(link);
		showToast(words.linkCopied);
	}
</script>

<Dialog bind:open title={words.publish} readFirst>
	<div class="flex flex-col gap-3">
		<p class="text-ink-2">{words.who}</p>
		{#if token !== null}
			<input
				class="{input} w-full"
				readonly
				aria-label={words.link}
				value={link}
				onfocus={(event) => event.currentTarget.select()}
			/>
		{/if}
		{#if problem !== null}
			<p class="rounded-box bg-tint p-2" role="alert">{problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if token === null}
			<div class="flex-1"></div>
			<Button variant="primary" disabled={!loaded || busy} onclick={publishView}
				>{words.publishNow}</Button
			>
		{:else}
			<Button variant="ghost" disabled={busy} onclick={unpublish}>{words.unpublish}</Button>
			<div class="flex-1"></div>
			<Button variant="primary" onclick={copy}>{words.copyLink}</Button>
		{/if}
	{/snippet}
</Dialog>
