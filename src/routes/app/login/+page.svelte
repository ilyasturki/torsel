<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { ApiError } from '#lib/client/api.ts';
	import { login } from '#lib/client/auth.ts';
	import { forgetAccount } from '#lib/client/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import { input } from '#lib/ui/styles.ts';

	let email = $state('');
	let password = $state('');
	let problem = $state('');
	let busy = $state(false);

	function destination(): string {
		const to = page.url.searchParams.get('to') ?? '/app';
		return to === '/app' || to.startsWith('/app/') || to.startsWith('/app?') ? to : '/app';
	}

	async function submit(): Promise<void> {
		problem = '';
		busy = true;
		try {
			await login(email, password);
			forgetAccount();
			await goto(destination(), { replaceState: true });
		} catch (error) {
			problem =
				error instanceof ApiError
					? error.status === 401
						? 'E-mail ou mot de passe incorrect.'
						: error.message
					: 'Connexion impossible.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Connexion · Torsel</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4">
	<form
		class="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-surface p-6"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<h1><Logo wordmark class="h-6" /></h1>
		<Field label="E-mail"
			><input
				class={input}
				type="email"
				bind:value={email}
				autocomplete="username"
				required
			/></Field
		>
		<Field label="Mot de passe"
			><input
				class={input}
				type="password"
				bind:value={password}
				autocomplete="current-password"
				required
			/></Field
		>
		<Button type="submit" variant="primary" size="lg" disabled={busy}>Se connecter</Button>
		{#if problem}<p class="text-sm" role="alert">{problem}</p>{/if}
	</form>
</main>
