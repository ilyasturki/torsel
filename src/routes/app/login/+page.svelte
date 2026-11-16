<script lang="ts">
	import { locale } from '#lib/i18n/runtime.ts';
	import { localePath } from '#lib/site/site.ts';
	import { onMount } from 'svelte';

	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';

	import { ApiError, apiBase } from '#lib/client/api.ts';
	import type { AuthConfig, Lookup } from '#lib/client/auth.ts';
	import {
		authConfig,
		login,
		lookup,
		requestSignInMail,
		signUp,
		verifyCode
	} from '#lib/client/auth.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { adoptSession } from '#lib/client/sync.svelte.ts';
	import { returnPath, returnTarget } from '#lib/core/return-path.ts';
	import Rich from '#lib/i18n/Rich.svelte';
	import { login as words } from '#lib/i18n/login.ts';
	import Button from '#lib/ui/Button.svelte';
	import CodeInput from '#lib/ui/CodeInput.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import PasswordInput from '#lib/ui/PasswordInput.svelte';
	import { input, linkButton } from '#lib/ui/styles.ts';
	import ServerForm from '#lib/views/ServerForm.svelte';

	const inApp = import.meta.env.APP_BUILD;
	const OAUTH_REFUSALS = new Map([
		['google', words.googleFailed],
		['google-closed', words.googleClosed]
	]);

	const rawTo = page.url.searchParams.get('to');
	const to = returnPath(rawTo);
	const target = returnTarget(rawTo);
	const googleHref = `/api/auth/google${to === null ? '' : `?to=${encodeURIComponent(to)}`}`;
	const emailLabel = inApp ? words.emailCode : words.emailLink;

	type Step = 'server' | 'email' | 'methods' | 'sent';

	let base = $state(apiBase());
	let step = $state<Step>(apiBase() === null ? 'server' : 'email');
	let config = $state<AuthConfig | null>(null);
	let email = $state('');
	let found = $state<Lookup | null>(null);
	let password = $state('');
	let code = $state('');
	let claim = $state<string | null>(null);
	let problem = $state(OAUTH_REFUSALS.get(page.url.searchParams.get('error') ?? '') ?? '');
	let busy = $state(false);
	let sentAgain = $state(false);

	const google = $derived(!inApp && config?.google === true);

	async function loadConfig(): Promise<void> {
		try {
			config = await authConfig();
		} catch {
			config = null;
		}
	}

	onMount(() => {
		if (page.url.searchParams.has('error')) {
			const clean = new URL(page.url.href);
			clean.searchParams.delete('error');
			replaceState(clean, {});
		}
		if (base !== null) {
			void loadConfig();
		}
	});

	function refusal(error: unknown, unauthorized: string): string {
		if (!(error instanceof ApiError)) {
			return words.offline;
		}
		return error.status === 401 ? unauthorized : error.message;
	}

	async function attempt(
		action: () => Promise<void>,
		unauthorized = words.wrongPassword
	): Promise<void> {
		if (busy) {
			return;
		}
		problem = '';
		busy = true;
		try {
			await action();
		} catch (error) {
			problem = refusal(error, unauthorized);
		} finally {
			busy = false;
		}
	}

	function submitEmail(): Promise<void> {
		return attempt(async () => {
			config ??= await authConfig();
			found = await lookup(email);
			password = '';
			step = 'methods';
		});
	}

	function backToEmail(): void {
		step = 'email';
		found = null;
		password = '';
		code = '';
		claim = null;
		problem = '';
		sentAgain = false;
	}

	async function finish(droppedPassword = false): Promise<void> {
		await adoptSession();
		await goto(droppedPassword ? SETTINGS : target, { replaceState: true });
	}

	function submitPassword(): Promise<void> {
		return attempt(async () => {
			await login(email, password);
			await finish();
		});
	}

	function createAccount(): Promise<void> {
		return attempt(async () => {
			claim = await signUp(email, password, to);
			step = 'sent';
		});
	}

	function sendMail(): Promise<void> {
		return attempt(async () => {
			await requestSignInMail(email, to);
			sentAgain = step === 'sent';
			step = 'sent';
		});
	}

	function submitCode(): Promise<void> {
		return attempt(async () => {
			try {
				const { droppedPassword } = await verifyCode(email, code, claim);
				await finish(droppedPassword);
			} catch (error) {
				code = '';
				throw error;
			}
		}, words.wrongCode);
	}

	function legalHref(path: string): string {
		const page = localePath(locale(), path);
		return inApp ? `${base}${page}` : page;
	}
</script>

<svelte:head>
	<title>{words.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet back()}
	<button
		type="button"
		class="-mt-1 inline-flex w-fit max-w-full items-center gap-1 text-ink-2 transition-colors motion hover:text-ink"
		aria-label={words.otherEmail}
		onclick={backToEmail}><Icon name="arrow-left" /><span class="truncate">{email}</span></button
	>
{/snippet}

{#snippet hiddenUsername()}
	<!-- The email's own form is gone by now: password managers read the pair from this one. -->
	<input
		class="sr-only"
		type="text"
		name="email"
		autocomplete="username"
		value={email}
		readonly
		tabindex="-1"
		aria-hidden="true"
	/>
{/snippet}

{#snippet googleButton()}
	<a class={linkButton} href={googleHref} data-sveltekit-reload>{words.google}</a>
{/snippet}

{#snippet alert()}
	{#if problem}<p role="alert">{problem}</p>{/if}
{/snippet}

<main class="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
	<div class="flex w-full max-w-sm flex-col gap-3 rounded-panel bg-raised p-6 shadow-raised">
		<div class="mb-1"><Logo wordmark class="h-6" /></div>

		{#if step === 'server'}
			<h1 class="text-lg font-semibold">{words.connectServer}</h1>
			<p class="text-ink-2">{words.serverIntro}</p>
			<ServerForm
				onconnected={(address) => {
					base = address;
					step = 'email';
					void loadConfig();
				}}
			/>
			<a class="text-ink-2 underline" href={target}>{words.keepOnPhone}</a>
		{:else if step === 'email'}
			<h1 class="text-lg font-semibold">{words.signInOrUp}</h1>
			{#if inApp}
				<p class="flex items-center gap-1 text-ink-2">
					<span class="min-w-0 truncate">{words.server(base ?? '')}</span>
					<button type="button" class="underline" onclick={() => (step = 'server')}
						>{words.change}</button
					>
				</p>
			{/if}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void submitEmail();
				}}
			>
				<Field label={words.email}
					><input
						class={input}
						type="email"
						name="email"
						autocomplete="username"
						autocapitalize="off"
						spellcheck="false"
						bind:value={email}
						required
					/></Field
				>
				<Button type="submit" variant="primary" disabled={busy}>{words.continue}</Button>
				{@render alert()}
			</form>
			{#if google}{@render googleButton()}{/if}
			<a class="text-ink-2 underline" href={target}>{words.keepWithout}</a>
			<p class="text-sm text-ink-3">
				<Rich text={words.consent}>
					{#snippet terms(label: string)}
						<a class="underline" href={legalHref('/terms')}>{label}</a>
					{/snippet}
					{#snippet privacy(label: string)}
						<a class="underline" href={legalHref('/privacy')}>{label}</a>
					{/snippet}
				</Rich>
			</p>
		{:else if step === 'sent'}
			<h1 class="text-lg font-semibold">{words.checkEmail}</h1>
			{@render back()}
			{#if config?.emailDelivers === false}
				<p role="status" class="text-ink-2">{words.noEmailService}</p>
			{:else if inApp}
				<p role="status" class="text-ink-2">{words.codeSent(email)}</p>
			{:else}
				<p role="status" class="text-ink-2">{words.mailSent(email)}</p>
			{/if}
			<CodeInput bind:value={code} disabled={busy} oncomplete={() => void submitCode()} />
			{@render alert()}
			<p class="text-sm text-ink-3">
				{#if sentAgain}
					{words.sentAgain}
				{:else}
					<Rich text={config?.emailDelivers === false ? words.lostIt : words.nothingYet}>
						{#snippet send(label: string)}
							<button
								type="button"
								class="underline"
								disabled={busy}
								onclick={() => void sendMail()}>{label}</button
							>
						{/snippet}
					</Rich>
				{/if}
			</p>
		{:else if found?.exists && !found.verified}
			<h1 class="text-lg font-semibold">{words.confirmEmail}</h1>
			{@render back()}
			<p class="text-ink-2">{words.notConfirmed}</p>
			<Button variant="primary" disabled={busy} onclick={() => void sendMail()}>{emailLabel}</Button
			>
			{@render alert()}
		{:else if found?.exists && found.hasPassword}
			<h1 class="text-lg font-semibold">{words.signIn}</h1>
			{@render back()}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void submitPassword();
				}}
			>
				{@render hiddenUsername()}
				<Field label={words.password}>
					<!-- svelte-ignore a11y_autofocus -->
					<PasswordInput bind:value={password} autocomplete="current-password" required autofocus />
				</Field>
				<Button type="submit" variant="primary" disabled={busy}>{words.signIn}</Button>
				{@render alert()}
			</form>
			<Button disabled={busy} onclick={() => void sendMail()}>{emailLabel}</Button>
			{#if google && found.hasGoogle}{@render googleButton()}{/if}
		{:else if found?.exists}
			<h1 class="text-lg font-semibold">{words.signIn}</h1>
			{@render back()}
			{#if google && found.hasGoogle}{@render googleButton()}{/if}
			<Button variant="primary" disabled={busy} onclick={() => void sendMail()}>{emailLabel}</Button
			>
			{@render alert()}
		{:else if config?.signUp}
			<h1 class="text-lg font-semibold">{words.createYours}</h1>
			{@render back()}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void createAccount();
				}}
			>
				{@render hiddenUsername()}
				<Field label={words.password} hint={words.passwordOptional}>
					<PasswordInput bind:value={password} autocomplete="new-password" minlength={8} />
				</Field>
				<Button type="submit" variant="primary" disabled={busy}>{words.createAccount}</Button>
				{@render alert()}
			</form>
			{#if google}{@render googleButton()}{/if}
		{:else}
			<h1 class="text-lg font-semibold">{words.noAccount}</h1>
			{@render back()}
			<p class="text-ink-2">{words.noNewAccounts}</p>
			<a class="text-ink-2 underline" href={target}>{words.keepWithout}</a>
		{/if}
	</div>
</main>
