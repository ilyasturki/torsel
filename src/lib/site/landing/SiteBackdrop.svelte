<script lang="ts">
	import { onMount } from 'svelte';

	import { Backdrop } from './backdrop.ts';

	let canvas = $state<HTMLCanvasElement>();

	onMount(() => {
		if (canvas === undefined) return;
		const target = canvas;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const dark = matchMedia('(prefers-color-scheme: dark)');
		let backdrop: Backdrop | null = null;

		const pointer = (event: PointerEvent): void => {
			if (event.pointerType === 'mouse') backdrop?.moveTo(event.clientX, event.clientY);
		};
		const leave = (): void => backdrop?.leave();
		const theme = (): void => backdrop?.readColors();
		let lastWidth = innerWidth;
		const resize = (): void => {
			if (innerWidth === lastWidth) return;
			lastWidth = innerWidth;
			backdrop?.resize();
			backdrop?.readColors();
		};

		const begin = (): void => {
			backdrop = new Backdrop(target);
			if (!reduced) {
				backdrop.start();
				addEventListener('pointermove', pointer, { passive: true });
				document.documentElement.addEventListener('pointerleave', leave);
			}
		};
		const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 60));
		idle(begin);
		dark.addEventListener('change', theme);
		addEventListener('resize', resize);

		return () => {
			backdrop?.stop();
			removeEventListener('pointermove', pointer);
			removeEventListener('resize', resize);
			document.documentElement.removeEventListener('pointerleave', leave);
			dark.removeEventListener('change', theme);
		};
	});
</script>

<div class="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
	<canvas
		bind:this={canvas}
		class="absolute top-0 left-0 [image-rendering:pixelated]"
		data-testid="backdrop"
	></canvas>
	<div class="absolute inset-0 site-cuts"></div>
	<div class="absolute inset-0 site-grain"></div>
</div>
