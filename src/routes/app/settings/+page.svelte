<script lang="ts">
	import { goto } from '$app/navigation';

	import { ApiError, DEFAULT_SERVER, apiBase, checkServer, setApiBase } from '#lib/client/api.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import type { PublicToken } from '#lib/client/auth.ts';
	import { createToken, listTokens, logout, revokeToken } from '#lib/client/auth.ts';
	import { formatDate } from '#lib/client/format.ts';
	import { LOGIN, SETTINGS } from '#lib/client/nav.ts';
	import { forgetAccount, me } from '#lib/client/session.svelte.ts';
	import { sync } from '#lib/client/sync.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import { input } from '#lib/ui/styles.ts';

	let base = $state(apiBase());
	let server = $state(apiBase() ?? DEFAULT_SERVER);
	let serverProblem = $state('');
	let tokens = $state<PublicToken[]>([]);
	let label = $state('Claude Code');
	let minted = $state<string | null>(null);
	let tokenProblem = $state('');

	async function refreshTokens(): Promise<void> {
		try {
			tokens = (await listTokens()).filter((token) => token.kind === 'api');
		} catch {
			tokens = [];
		}
	}

	$effect(() => {
		if (me.account) void refreshTokens();
	});

	async function connect(): Promise<void> {
		serverProblem = '';
		const address = server.trim().replace(/\/+$/u, '');
		try {
			await checkServer(address);
			setApiBase(address);
			base = address;
		} catch (error) {
			serverProblem = error instanceof ApiError ? error.message : 'That address doesn’t work.';
		}
	}

	async function signOut(): Promise<void> {
		await logout().catch(() => undefined);
		forgetAccount();
		me.account = null;
		sync.status = 'idle';
		if (!import.meta.env.APP_BUILD) void goto(LOGIN);
	}

	async function mint(): Promise<void> {
		tokenProblem = '';
		try {
			const { token } = await createToken(label.trim() || 'MCP');
			minted = token;
			await refreshTokens();
		} catch {
			tokenProblem = 'Couldn’t create the token. Try again.';
		}
	}

	async function revoke(id: string): Promise<void> {
		tokenProblem = '';
		try {
			await revokeToken(id);
			await refreshTokens();
		} catch {
			tokenProblem = 'Couldn’t revoke the token. Try again.';
		}
	}

	function exportJson(): void {
		const payload = {
			format: 'torsel',
			version: 1,
			exportedAt: new Date().toISOString(),
			records: [...app.ws.records.values()]
		};
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(payload)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `torsel-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	const mcpUrl = $derived(`${base ?? DEFAULT_SERVER}/api/mcp`);
	const command = $derived(
		minted
			? `claude mcp add --transport http torsel ${mcpUrl} --header "Authorization: Bearer ${minted}"`
			: ''
	);
</script>

<div class="flex max-w-prose flex-col gap-6 p-4 pb-tabs-clear">
	{#if import.meta.env.APP_BUILD}
		<details open={!base}>
			<summary class="font-semibold">Server{base ? `: ${base}` : ''}</summary>
			<div class="mt-3 flex flex-col gap-3">
				<p class="text-ink-2">
					Without a server, everything stays on this phone. Connect one to sync and use the
					assistant.
				</p>
				<form
					class="flex gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						void connect();
					}}
				>
					<input class={input} bind:value={server} inputmode="url" aria-label="Server address" />
					<Button type="submit">Connect</Button>
				</form>
				{#if serverProblem}<p role="alert">{serverProblem}</p>{/if}
			</div>
		</details>
	{/if}

	{#if base}
		<section class="flex flex-col gap-3">
			<h2 class="font-semibold">Account</h2>
			{#if me.account}
				<div class="flex items-center justify-between gap-3">
					<span class="min-w-0 truncate">{me.account.email}</span>
					<Button onclick={signOut}>Sign out</Button>
				</div>
			{:else if me.account === null}
				<a class="self-start font-medium underline" href="{LOGIN}?to={encodeURIComponent(SETTINGS)}"
					>Sign in</a
				>
			{:else}
				<p class="text-ink-2">Can’t reach the server right now.</p>
			{/if}
		</section>
	{/if}

	{#if me.account}
		<section class="flex flex-col gap-3">
			<h2 class="font-semibold">Agents (MCP)</h2>
			<p class="text-ink-2">
				A token lets Claude Code, Claude.ai or another MCP client read and change your tables at {mcpUrl}.
			</p>
			<form
				class="flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void mint();
				}}
			>
				<input class={input} bind:value={label} aria-label="Token name" />
				<Button type="submit">Create token</Button>
			</form>
			{#if tokenProblem}<p role="alert">{tokenProblem}</p>{/if}
			{#if minted}
				<div class="flex flex-col items-start gap-2 rounded-box bg-tint p-3">
					<p class="font-medium">Copy it now. It won’t be shown again.</p>
					<code class="font-mono text-sm break-all">{command}</code>
					<Button onclick={() => void navigator.clipboard.writeText(command)}>Copy command</Button>
				</div>
			{/if}
			{#if tokens.length > 0}
				<div class="flex flex-col">
					{#each tokens as token (token.id)}
						<div class="flex min-h-row items-center justify-between gap-3">
							<span class="flex min-w-0 flex-col">
								<span class="truncate">{token.label}</span>
								<span class="truncate text-sm text-ink-3"
									>{token.prefix}…, created {formatDate(
										new Date(token.createdAt).toISOString().slice(0, 10),
										true
									)}</span
								>
							</span>
							<Button variant="ghost" onclick={() => revoke(token.id)}>Revoke</Button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<section class="flex items-center justify-between gap-3">
		<span>All data on this device</span>
		<Button onclick={exportJson}>Export as JSON</Button>
	</section>

	<p class="text-sm text-ink-3">Torsel {import.meta.env.APP_VERSION}</p>
</div>
