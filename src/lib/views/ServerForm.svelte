<script lang="ts">
	import { ApiError, DEFAULT_SERVER, apiBase, checkServer, setApiBase } from '#lib/client/api.ts';
	import { shell as words } from '#lib/i18n/shell.ts';
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
			problem = error instanceof ApiError ? error.message : words.badAddress;
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
		aria-label={words.serverAddress}
	/>
	<Button type="submit">{words.connect}</Button>
</form>
{#if problem}<p role="alert">{problem}</p>{/if}
