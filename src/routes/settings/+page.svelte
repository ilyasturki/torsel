<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Copy from '@lucide/svelte/icons/copy';

	import { goto } from '$app/navigation';

	import { ApiError, DEFAULT_SERVER, apiBase, checkServer, setApiBase } from '#lib/client/api.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import type { PublicToken } from '#lib/client/auth.ts';
	import {
		createToken,
		listTokens,
		login,
		logout,
		revokeToken,
		session
	} from '#lib/client/auth.ts';
	import { formatDate } from '#lib/client/format.ts';
	import { forgetAccount, me } from '#lib/client/session.svelte.ts';
	import { claimOwner, startSync, sync, syncNow } from '#lib/client/sync.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import { input } from '#lib/ui/styles.ts';

	let server = $state(apiBase() ?? DEFAULT_SERVER);
	let serverProblem = $state('');
	let email = $state('');
	let password = $state('');
	let loginProblem = $state('');
	let tokens = $state<PublicToken[]>([]);
	let label = $state('Claude Code');
	let minted = $state<string | null>(null);

	const base = $derived(apiBase());
	const statusText = $derived(
		{
			idle: sync.last
				? `À jour, ${new Date(sync.last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
				: 'En attente',
			syncing: 'Synchronisation…',
			offline: 'Hors ligne : les modifications partiront au retour du réseau',
			'signed-out': 'Déconnecté du serveur',
			'no-server': 'Aucun serveur : les données restent sur cet appareil',
			'other-account': 'Les données de cet appareil appartiennent à un autre compte',
			error: sync.message || 'Erreur de synchronisation'
		}[sync.status]
	);

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
		} catch (error) {
			serverProblem = error instanceof ApiError ? error.message : 'Adresse invalide';
		}
	}

	async function signIn(): Promise<void> {
		loginProblem = '';
		try {
			await login(email, password);
			const account = await session();
			me.account = account;
			password = '';
			if (await claimOwner(account.id)) startSync();
		} catch (error) {
			loginProblem = error instanceof ApiError ? error.message : 'Connexion impossible';
		}
	}

	async function signOut(): Promise<void> {
		await logout().catch(() => undefined);
		forgetAccount();
		me.account = null;
		if (!import.meta.env.APP_BUILD) void goto('/login');
	}

	async function mint(): Promise<void> {
		const { token } = await createToken(label.trim() || 'MCP');
		minted = token;
		await refreshTokens();
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
			href="/"
			class="-ml-2 flex h-11 items-center gap-1 self-start rounded-lg pr-2 text-ink-muted lg:hidden"
			><ChevronLeft class="size-5" /> Bases</a
		>
		<h1 class="px-1 text-[30px] leading-9 font-bold tracking-tight">Réglages</h1>
	</header>

	{#if import.meta.env.APP_BUILD}
		<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
			<h2 class="font-semibold">Serveur</h2>
			<p class="text-sm text-ink-muted">
				Sans serveur, tout reste sur ce téléphone. Avec, tes données se synchronisent et l’IA
				devient disponible.
			</p>
			<form
				class="flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void connect();
				}}
			>
				<input class={input} bind:value={server} inputmode="url" aria-label="Adresse du serveur" />
				<Button type="submit">Connecter</Button>
			</form>
			{#if base}<p class="text-sm">Connecté à {base}</p>{/if}
			{#if serverProblem}<p class="text-sm" role="alert">{serverProblem}</p>{/if}
		</section>
	{/if}

	<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
		<h2 class="font-semibold">Compte</h2>
		{#if me.account}
			<div class="flex items-center justify-between gap-3">
				<span>{me.account.email}</span>
				<Button size="sm" onclick={signOut}>Se déconnecter</Button>
			</div>
		{:else if import.meta.env.APP_BUILD && base}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void signIn();
				}}
			>
				<Field label="E-mail"
					><input class={input} type="email" bind:value={email} autocomplete="username" /></Field
				>
				<Field label="Mot de passe"
					><input
						class={input}
						type="password"
						bind:value={password}
						autocomplete="current-password"
					/></Field
				>
				<Button type="submit" variant="primary">Se connecter</Button>
				{#if loginProblem}<p class="text-sm" role="alert">{loginProblem}</p>{/if}
			</form>
		{:else}
			<p class="text-sm text-ink-muted">Non connecté.</p>
		{/if}
	</section>

	<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
		<div class="flex items-center justify-between gap-3">
			<h2 class="font-semibold">Synchronisation</h2>
			<Button size="sm" onclick={() => void syncNow()} disabled={!me.account}>Synchroniser</Button>
		</div>
		<p class="text-sm text-ink-muted">{statusText}</p>
		{#if app.pending > 0}
			<p class="text-sm">
				{app.pending} modification{app.pending > 1 ? 's' : ''} seulement sur cet appareil
			</p>
		{/if}
		{#if sync.status === 'other-account'}
			<Button size="sm" onclick={() => void app.reset()}>Effacer les données de cet appareil</Button
			>
		{/if}
	</section>

	{#if me.account}
		<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
			<h2 class="font-semibold">Agents (MCP)</h2>
			<p class="text-sm text-ink-muted">
				Un jeton laisse Claude Code, Claude.ai ou un autre client MCP lire et modifier tes bases sur {mcpUrl}.
			</p>
			<form
				class="flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void mint();
				}}
			>
				<input class={input} bind:value={label} aria-label="Nom du jeton" />
				<Button type="submit">Créer un jeton</Button>
			</form>
			{#if minted}
				<div class="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
					<p class="text-sm font-medium">Copie-le maintenant : il ne sera plus affiché.</p>
					<code class="font-mono text-xs break-all">{command}</code>
					<Button size="sm" onclick={() => void navigator.clipboard.writeText(command)}
						><Copy class="size-4" /> Copier la commande</Button
					>
				</div>
			{/if}
			{#each tokens as token (token.id)}
				<div class="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
					<span class="flex flex-col">
						<span class="text-[15px]">{token.label}</span>
						<span class="text-xs text-ink-faint"
							>{token.prefix}… · créé le {formatDate(
								new Date(token.createdAt).toISOString().slice(0, 10),
								true
							)}</span
						>
					</span>
					<Button
						size="sm"
						variant="ghost"
						onclick={async () => {
							await revokeToken(token.id);
							await refreshTokens();
						}}>Révoquer</Button
					>
				</div>
			{/each}
		</section>
	{/if}

	<section class="flex flex-col gap-3 rounded-2xl bg-surface p-4">
		<h2 class="font-semibold">Données</h2>
		<p class="text-sm text-ink-muted">
			Tout ce que contient cet appareil, en JSON. Pour reprendre des données ailleurs, importe un
			CSV depuis l’accueil.
		</p>
		<div><Button size="sm" onclick={exportJson}>Exporter en JSON</Button></div>
	</section>

	<p class="px-1 text-xs text-ink-faint">
		Torsel {import.meta.env.APP_VERSION} · logiciel libre (MIT)
	</p>
</div>
