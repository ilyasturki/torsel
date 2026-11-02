<script lang="ts">
	import '../app.css';

	import { Tooltip } from 'bits-ui';

	let { children } = $props();
</script>

<Tooltip.Provider delayDuration={500} disableHoverableContent>
	{@render children()}
</Tooltip.Provider>
