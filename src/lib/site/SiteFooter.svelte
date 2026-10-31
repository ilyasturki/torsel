<script lang="ts">
	import { HOME } from '#lib/client/nav.ts';
	import Logo from '#lib/ui/Logo.svelte';

	import { LEGAL_NAME, LEGAL_REGISTRATION, REPOSITORY } from './site.ts';

	const item = 'text-ink-2 transition-colors motion hover:text-ink';
</script>

<footer class="bg-raised shadow-raised">
	<div
		class="flex flex-wrap items-start justify-between gap-x-16 gap-y-8 px-gutter pt-10 pb-10 max-sm:pb-8"
	>
		<div class="flex flex-col gap-3">
			<Logo wordmark class="h-4 self-start text-ink" />
			<p class="max-w-72 text-ink-3">
				{LEGAL_NAME}, {LEGAL_REGISTRATION}. Open source under the MIT license.
			</p>
		</div>
		<nav class="flex flex-wrap gap-x-12 gap-y-6" aria-label="Footer">
			<ul class="flex flex-col gap-2">
				<li><a class={item} href={HOME}>Open the app</a></li>
				<li><a class={item} href={REPOSITORY} rel="me">GitHub</a></li>
				<li><a class={item} href="/llms.txt">llms.txt</a></li>
			</ul>
			<ul class="flex flex-col gap-2">
				<li><a class={item} href="/privacy">Privacy</a></li>
				<li><a class={item} href="/terms">Terms</a></li>
			</ul>
		</nav>
	</div>
</footer>
