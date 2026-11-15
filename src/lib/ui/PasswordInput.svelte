<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	import { ui as words } from '#lib/i18n/ui.ts';

	import Icon from './Icon.svelte';
	import { input } from './styles.ts';

	let {
		value = $bindable(''),
		...rest
	}: Omit<HTMLInputAttributes, 'type' | 'value'> & { value?: string } = $props();

	let revealed = $state(false);
</script>

<span class="relative block">
	<input
		{...rest}
		class="{input} pr-control"
		type={revealed ? 'text' : 'password'}
		name="password"
		autocapitalize="off"
		spellcheck="false"
		bind:value
	/>
	<button
		type="button"
		class="absolute inset-y-0 right-0 flex w-control items-center justify-center text-ink-3 transition-colors motion hover:text-ink"
		aria-label={revealed ? words.hidePassword : words.showPassword}
		onclick={() => (revealed = !revealed)}><Icon name={revealed ? 'eye-off' : 'eye'} /></button
	>
</span>
