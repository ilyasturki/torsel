<script lang="ts">
	import type { LinkImport } from '#lib/client/link.svelte.ts';
	import { sources as words } from '#lib/i18n/sources.ts';
	import Button from '#lib/ui/Button.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { input } from '#lib/ui/styles.ts';

	// `onretry` reads the link again with the key; the import moves on when it answers.
	let { link, onretry }: { link: LinkImport; onretry: () => void } = $props();

	const KINDS = ['bearer', 'header', 'query', 'basic'] as const;

	const named = $derived(link.auth.kind === 'header' || link.auth.kind === 'query');
</script>

<div class="flex flex-col gap-2" data-testid="link-key">
	<div class="flex gap-2">
		<Select
			class="w-40 shrink-0"
			aria-label={words.authKind}
			options={KINDS.map((kind) => ({ value: kind, label: words.authKinds[kind] }))}
			value={link.auth.kind === 'none' ? 'bearer' : link.auth.kind}
			onchange={(kind) => (link.auth = { kind, name: link.auth.name })}
		/>
		{#if named}
			<input
				class={input}
				aria-label={link.auth.kind === 'query' ? words.authName.query : words.authName.header}
				placeholder={link.auth.kind === 'query' ? words.authName.query : words.authName.header}
				autocapitalize="off"
				spellcheck="false"
				value={link.auth.name ?? ''}
				oninput={(event) => (link.auth = { kind: link.auth.kind, name: event.currentTarget.value })}
			/>
		{/if}
	</div>
	<div class="flex gap-2">
		<input
			class={input}
			type="password"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			data-1p-ignore
			aria-label={words.key}
			placeholder={link.auth.kind === 'basic' ? words.userPassword : words.key}
			bind:value={link.secret}
		/>
		<Button
			disabled={link.secret.trim() === '' ||
				(named && (link.auth.name ?? '').trim() === '') ||
				link.busy}
			onclick={onretry}>{words.retry}</Button
		>
	</div>
</div>
