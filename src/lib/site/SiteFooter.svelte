<script lang="ts">
	import { LEGAL_NAME, LEGAL_REGISTRATION, REPOSITORY } from './site.ts';

	const item = 'transition-colors motion hover:text-ink';
</script>

<footer
	class="flex flex-wrap justify-between gap-x-5 gap-y-1.5 rounded-panel bg-raised px-4 py-3.5 text-sm text-ink-2 shadow-raised"
>
	<span>{LEGAL_NAME}, {LEGAL_REGISTRATION}. MIT licensed.</span>
	<nav class="flex gap-4" aria-label="Footer">
		<a class={item} href={REPOSITORY} rel="me">GitHub</a>
		<a class={item} href="/llms.txt">llms.txt</a>
		<a class={item} href="/privacy">Privacy</a>
		<a class={item} href="/terms">Terms</a>
	</nav>
</footer>
