<script lang="ts">
	import { ApiError, DEFAULT_SERVER, apiBase, checkServer, setApiBase } from '#lib/client/api.ts';
	import Button from '#lib/ui/Button.svelte';
	import { input } from '#lib/ui/styles.ts';

	let { onconnected }: { onconnected: (address: string) => void } = $props();

	let server = $state(apiBase() ?? DEFAULT_SERVER);
	let problem = $state('');

	async function connect(): Promise<void> {
		problem = '';
		const address = server.trim().replace(/\/+$/u, '');
		try {
			await checkServer(address);
			setApiBase(address);
			onconnected(address);
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That address doesn’t work.';
		}
	}
</script>

<form
	class="flex gap-2"
	onsubmit={(event) => {
		event.preventDefault();
		void connect();
	}}
>
	<input
		class={input}
		bind:value={server}
		inputmode="url"
		placeholder="https://torsel.example.com"
		aria-label="Server address"
	/>
	<Button type="submit">Connect</Button>
</form>
{#if problem}<p role="alert">{problem}</p>{/if}
