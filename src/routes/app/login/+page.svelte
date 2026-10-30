<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { ApiError } from '#lib/client/api.ts';
	import { login } from '#lib/client/auth.ts';
	import { HOME } from '#lib/client/nav.ts';
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
		const to = page.url.searchParams.get('to') ?? HOME;
		return to === HOME || to.startsWith(`${HOME}/`) || to.startsWith(`${HOME}?`) ? to : HOME;
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
						? 'Wrong email or password.'
						: error.message
					: "Couldn't sign in. Check your connection and try again.";
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in · Torsel</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4">
	<form
		class="flex w-full max-w-sm flex-col gap-3 rounded-panel bg-raised p-6 shadow-raised"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<h1 class="mb-1"><Logo wordmark class="h-6" /></h1>
		<Field label="Email"
			><input
				class={input}
				type="email"
				bind:value={email}
				autocomplete="username"
				required
			/></Field
		>
		<Field label="Password"
			><input
				class={input}
				type="password"
				bind:value={password}
				autocomplete="current-password"
				required
			/></Field
		>
		<Button type="submit" variant="primary" disabled={busy}>Sign in</Button>
		{#if problem}<p role="alert">{problem}</p>{/if}
	</form>
</main>
