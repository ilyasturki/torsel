<script lang="ts">
	import { page } from '$app/state';

	import { HOME } from '#lib/client/nav.ts';

	const missing = $derived(page.status === 404);
</script>

<div class="flex min-h-full flex-col items-start justify-center gap-3 p-6 pb-tabs-clear">
	<p class="text-hero leading-none font-semibold tighter text-ink-3">{page.status}</p>
	<h2 class="text-xl font-semibold tight">
		{missing ? 'Nothing at this address' : 'Something broke on this screen'}
	</h2>
	<p class="max-w-prose text-ink-2">
		{missing
			? 'Your tables are all still here.'
			: 'Your data is safe on this device. Go back to your tables and try again.'}
	</p>
	<a
		href={HOME}
		class="inline-flex h-control items-center rounded-box bg-fill px-3 font-medium text-on-fill transition-opacity motion hover:opacity-90"
		>Back to your tables</a
	>
</div>
