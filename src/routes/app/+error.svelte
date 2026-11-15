<script lang="ts">
	import { page } from '$app/state';

	import { HOME } from '#lib/client/nav.ts';
	import { home as words } from '#lib/i18n/home.ts';
	import { linkButton } from '#lib/ui/styles.ts';
</script>

<div class="flex flex-col items-start gap-3 p-4">
	<h2 class="font-semibold">
		{page.status === 404 ? words.notFound : words.screenBroke}
	</h2>
	<a href={HOME} class={linkButton}>{words.backToTables}</a>
</div>
