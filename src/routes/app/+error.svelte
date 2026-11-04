<script lang="ts">
	import { page } from '$app/state';

	import { HOME } from '#lib/client/nav.ts';
	import { linkButton } from '#lib/ui/styles.ts';
</script>

<div class="flex flex-col items-start gap-3 p-4">
	<h2 class="font-semibold">
		{page.status === 404 ? 'Nothing at this address' : 'Something broke on this screen'}
	</h2>
	<a href={HOME} class={linkButton}>Back to your tables</a>
</div>
