<script lang="ts">
	import { ApiError, DEFAULT_SERVER, apiBase } from '#lib/client/api.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import { checkAvailability } from '#lib/client/assistant.svelte.ts';
	import type { PublicToken } from '#lib/client/auth.ts';
	import { createToken, listTokens, revokeToken, setPassword } from '#lib/client/auth.ts';
	import { formatDate } from '#lib/client/format.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { downloadBackup, shell } from '#lib/client/shell.svelte.ts';
	import { eraseDevice, signOut } from '#lib/client/sync.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { signInPath } from '#lib/core/return-path.ts';
	import { settings as words } from '#lib/i18n/settings.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import PasswordInput from '#lib/ui/PasswordInput.svelte';
	import type { Option } from '#lib/ui/Select.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { input } from '#lib/ui/styles.ts';
	import ServerForm from '#lib/views/ServerForm.svelte';

	let base = $state(apiBase());
	let newPassword = $state('');
	let passwordProblem = $state('');
	let erasing = $state(false);
	let tokens = $state<PublicToken[]>([]);
	let label = $state('Claude Code');
	let access = $state<PublicToken['access']>('write');
	let lifetime = $state('never');
	let minted = $state<string | null>(null);
	let tokenProblem = $state('');

	// From sm up a section reads as a row: its name on the left, what it holds on the right.
	const row = 'flex flex-col gap-3 sm:flex-row sm:gap-8 sm:border-b sm:border-rule sm:py-6';
	const rowName = 'font-semibold sm:w-48 sm:shrink-0';
	const rowBody = 'flex max-w-xl min-w-0 flex-1 flex-col gap-3';

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

	async function leave(): Promise<void> {
		showToast((await signOut()) ? words.signedOut : words.stillSignedIn);
	}

	async function savePassword(): Promise<void> {
		passwordProblem = '';
		try {
			await setPassword(newPassword);
			newPassword = '';
			if (me.account) me.account.hasPassword = true;
			await refreshTokens();
			showToast(words.passwordSaved);
		} catch (error) {
			passwordProblem = error instanceof ApiError ? error.message : words.passwordFailed;
		}
	}

	async function mint(): Promise<void> {
		tokenProblem = '';
		try {
			const { token } = await createToken(
				label.trim() || 'MCP',
				access,
				lifetime === 'never' ? null : Number(lifetime)
			);
			minted = token;
			await refreshTokens();
		} catch {
			tokenProblem = words.tokenFailed;
		}
	}

	async function revoke(id: string): Promise<void> {
		tokenProblem = '';
		try {
			await revokeToken(id);
			await refreshTokens();
		} catch {
			tokenProblem = words.revokeFailed;
		}
	}

	const ACCESS: Option<PublicToken['access']>[] = [
		{ value: 'write', label: words.readWrite },
		{ value: 'read', label: words.readOnly }
	];
	const LIFETIMES: Option[] = [
		{ value: 'never', label: words.noExpiry },
		{ value: '30', label: words.days(30) },
		{ value: '90', label: words.days(90) },
		{ value: '365', label: words.oneYear }
	];

	const day = (ms: number): string =>
		formatDate(new Date(ms).toISOString().slice(0, 10), { withYear: true });

	function details(token: PublicToken): string {
		return words.tokenDetails(
			token.prefix,
			token.access,
			token.lastUsedAt === null ? null : day(token.lastUsedAt),
			token.expiresAt === null
				? null
				: { date: day(token.expiresAt), past: token.expiresAt <= Date.now() }
		);
	}

	const mcpUrl = $derived(`${base ?? DEFAULT_SERVER}/api/mcp`);
	const command = $derived(
		minted
			? `claude mcp add --transport http torsel ${mcpUrl} --header "Authorization: Bearer ${minted}"`
			: ''
	);
</script>

<div class="flex flex-col gap-6 p-4 sm:max-w-4xl sm:gap-0 sm:px-6 sm:py-0">
	{#if import.meta.env.APP_BUILD}
		<details open={!base}>
			<summary class="font-semibold">{words.server(base ?? '')}</summary>
			<div class="mt-3 flex flex-col gap-3">
				<ServerForm
					onconnected={(address) => {
						base = address;
						void checkAvailability();
					}}
				/>
			</div>
		</details>
	{/if}

	{#if base}
		<section class={row}>
			<h2 class={rowName}>{words.account}</h2>
			<div class={rowBody}>
				{#if me.account}
					<div class="flex items-center justify-between gap-3">
						<span class="min-w-0 truncate">{me.account.email}</span>
						<Button onclick={leave}>{words.signOut}</Button>
					</div>
					<form
						class="flex flex-col gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							void savePassword();
						}}
					>
						<input
							class="sr-only"
							type="text"
							name="email"
							autocomplete="username"
							value={me.account.email}
							readonly
							tabindex="-1"
							aria-hidden="true"
						/>
						<Field
							label={me.account.hasPassword ? words.newPassword : words.password}
							hint={me.account.hasPassword ? words.changeHint : words.setHint}
						>
							<PasswordInput
								bind:value={newPassword}
								autocomplete="new-password"
								minlength={8}
								required
							/>
						</Field>
						<Button type="submit" class="self-start">
							{me.account.hasPassword ? words.changePassword : words.setPassword}
						</Button>
						{#if passwordProblem}<p role="alert">{passwordProblem}</p>{/if}
					</form>
				{:else if me.account === null}
					<a class="self-start font-medium underline" href={signInPath(SETTINGS)}>{words.signIn}</a>
				{:else}
					<p class="text-ink-2">{words.serverUnreachable}</p>
				{/if}
			</div>
		</section>
	{/if}

	{#if me.account}
		<section class={row}>
			<h2 class={rowName}>{words.agents}</h2>
			<div class={rowBody}>
				<code class="font-mono text-sm break-all text-ink-2">{mcpUrl}</code>
				<form
					class="flex flex-wrap gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						void mint();
					}}
				>
					<input
						class="{input} min-w-0 basis-full sm:flex-1 sm:basis-auto"
						bind:value={label}
						aria-label={words.tokenName}
					/>
					<Select
						class="flex-1 sm:w-44 sm:flex-none"
						options={ACCESS}
						bind:value={access}
						aria-label={words.access}
					/>
					<Select
						class="flex-1 sm:w-40 sm:flex-none"
						options={LIFETIMES}
						bind:value={lifetime}
						aria-label={words.expiry}
					/>
					<Button type="submit" class="max-sm:basis-full">{words.createToken}</Button>
				</form>
				{#if tokenProblem}<p role="alert">{tokenProblem}</p>{/if}
				{#if minted}
					<div class="flex flex-col items-start gap-2 rounded-box bg-tint p-3">
						<p class="font-medium">{words.copyNow}</p>
						<code class="font-mono text-sm break-all">{command}</code>
						<Button onclick={() => void navigator.clipboard.writeText(command)}
							>{words.copyCommand}</Button
						>
					</div>
				{/if}
				{#if tokens.length > 0}
					<div class="flex flex-col">
						{#each tokens as token (token.id)}
							<div class="flex min-h-row items-center justify-between gap-3">
								<span class="flex min-w-0 flex-col">
									<span class="truncate">{token.label}</span>
									<span class="text-sm text-ink-3">{details(token)}</span>
								</span>
								<Button variant="ghost" onclick={() => revoke(token.id)}>{words.revoke}</Button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	{/if}

	<section class="{row} max-sm:flex-row max-sm:items-center">
		<h2 class="{rowName} max-sm:flex-1 max-sm:font-normal">{words.allData}</h2>
		<div class="flex gap-3">
			<Button onclick={() => (shell.importing = { into: null })}>{words.import}</Button>
			<Button onclick={downloadBackup}>{words.export}</Button>
		</div>
	</section>

	{#if me.account === null}
		<section class="{row} max-sm:flex-row max-sm:items-center">
			<h2 class="{rowName} max-sm:flex-1 max-sm:font-normal">
				{erasing
					? words.cantUndo
					: import.meta.env.APP_BUILD
						? words.leavingDevice
						: words.leavingBrowser}
			</h2>
			{#if erasing}
				<Button onclick={() => void eraseDevice()}>{words.eraseForGood}</Button>
			{:else}
				<Button onclick={() => (erasing = true)}>{words.eraseDevice}</Button>
			{/if}
		</section>
	{/if}

	<p class="text-sm text-ink-3 sm:py-6">Torsel {import.meta.env.APP_VERSION}</p>
</div>
