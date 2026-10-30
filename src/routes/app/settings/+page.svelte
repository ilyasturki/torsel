<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Copy from '@lucide/svelte/icons/copy';

	import { goto } from '$app/navigation';

	import { ApiError, DEFAULT_SERVER, apiBase, checkServer, setApiBase } from '#lib/client/api.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import type { PublicToken } from '#lib/client/auth.ts';
	import { createToken, listTokens, logout, revokeToken } from '#lib/client/auth.ts';
	import { formatDate } from '#lib/client/format.ts';
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
		if (!import.meta.env.APP_BUILD) void goto('/app/login');
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

<div class="mx-auto flex max-w-2xl flex-col gap-6 pt-1">
	<header class="flex flex-col gap-1">
		<a
			href="/app"
			class="-ml-2 flex h-11 items-center gap-1 self-start rounded-lg pr-2 text-ink-muted lg:hidden"
			><ChevronLeft class="size-5" /> Bases</a
		>
		<h1 class="px-1 text-[30px] leading-9 font-bold tracking-tight">Settings</h1>
	</header>

	{#if import.meta.env.APP_BUILD}
		<details class="rounded-2xl bg-surface p-4" open={!base}>
			<summary class="font-semibold">Server{base ? `: ${base}` : ''}</summary>
			<div class="mt-3 flex flex-col gap-3">
				<p class="text-sm text-ink-muted">
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
				{#if serverProblem}<p class="text-sm" role="alert">{serverProblem}</p>{/if}
			</div>
		</details>
	{/if}

	{#if base}
		<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
			<h2 class="font-semibold">Account</h2>
			{#if me.account}
				<div class="flex items-center justify-between gap-3">
					<span>{me.account.email}</span>
					<Button size="sm" onclick={signOut}>Sign out</Button>
				</div>
			{:else if me.account === null}
				<a class="self-start font-semibold underline" href="/app/login?to=%2Fapp%2Fsettings">Sign in</a>
			{:else}
				<p class="text-sm text-ink-muted">Can’t reach the server right now.</p>
			{/if}
		</section>
	{/if}

	{#if me.account}
		<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
			<h2 class="font-semibold">Agents (MCP)</h2>
			<p class="text-sm text-ink-muted">
				A token lets Claude Code, Claude.ai or another MCP client read and change your bases at {mcpUrl}.
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
			{#if tokenProblem}<p class="text-sm" role="alert">{tokenProblem}</p>{/if}
			{#if minted}
				<div class="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
					<p class="text-sm font-medium">Copy it now. It won’t be shown again.</p>
					<code class="font-mono text-xs break-all">{command}</code>
					<Button size="sm" onclick={() => void navigator.clipboard.writeText(command)}
						><Copy class="size-4" /> Copy command</Button
					>
				</div>
			{/if}
			{#each tokens as token (token.id)}
				<div class="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
					<span class="flex flex-col">
						<span class="text-[15px]">{token.label}</span>
						<span class="text-xs text-ink-faint"
							>{token.prefix}… · created {formatDate(
								new Date(token.createdAt).toISOString().slice(0, 10),
								true
							)}</span
						>
					</span>
					<Button size="sm" variant="ghost" onclick={() => revoke(token.id)}>Revoke</Button>
				</div>
			{/each}
		</section>
	{/if}

	<section class="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4">
		<span>All data on this device</span>
		<Button size="sm" onclick={exportJson}>Export as JSON</Button>
	</section>

	<p class="px-1 text-xs text-ink-faint">Torsel {import.meta.env.APP_VERSION}</p>
</div>
