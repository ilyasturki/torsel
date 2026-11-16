<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';

	import { Field, type Keep, type Shape } from './cells.ts';

	let {
		shape,
		keep,
		class: extra = '',
		children
	}: { shape: Shape; keep?: HTMLElement; class?: string; children: Snippet } = $props();

	let section = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();

	onMount(() => {
		if (section === undefined || canvas === undefined) return;
		const host = section;
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const dark = matchMedia('(prefers-color-scheme: dark)');
		const field = new Field(canvas, shape, still);
		const token = shape === 'chart' ? '--chart-cell' : '--site-cell';
		let pitch = 13;

		const size = (): void => {
			pitch = parseFloat(getComputedStyle(host).getPropertyValue(token)) || pitch;
			const box = host.getBoundingClientRect();
			let kept: Keep | null = null;
			if (keep !== undefined) {
				const copy = keep.getBoundingClientRect();
				kept = {
					left: Math.floor((copy.left - box.left) / pitch),
					right: Math.ceil((copy.right - box.left) / pitch),
					bottom: Math.ceil((copy.bottom - box.top) / pitch)
				};
			}
			field.resize(host.clientWidth, host.clientHeight, pitch, kept);
			field.draw(performance.now());
		};
		const at = (clientX: number, clientY: number): void => {
			const box = host.getBoundingClientRect();
			field.paint(clientX - box.left, clientY - box.top, pitch);
		};
		const pointer = (event: PointerEvent): void => at(event.clientX, event.clientY);
		// A finger scrolling the page sends no pointer moves once the scroll takes over.
		const touch = (event: TouchEvent): void => {
			const point = event.touches[0];
			if (point !== undefined) at(point.clientX, point.clientY);
		};
		const leave = (): void => field.leave();
		const theme = (): void => {
			field.readColors(dark.matches);
			field.draw(performance.now());
		};
		let shown = true;
		const seen = new IntersectionObserver(([entry]) => {
			shown = entry?.isIntersecting ?? true;
			if (still) return;
			if (shown && !field.running) field.start();
			if (!shown) field.stop();
		});

		const begin = (): void => {
			field.readColors(dark.matches);
			size();
			if (still) return;
			if (shown) field.start();
			host.addEventListener('pointermove', pointer, { passive: true });
			host.addEventListener('pointerdown', pointer, { passive: true });
			host.addEventListener('pointerleave', leave);
			host.addEventListener('touchmove', touch, { passive: true });
			host.addEventListener('touchend', leave, { passive: true });
		};
		const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 60));
		idle(begin);
		const observer = new ResizeObserver(size);
		observer.observe(host);
		if (keep !== undefined) observer.observe(keep);
		seen.observe(host);
		dark.addEventListener('change', theme);

		return () => {
			field.stop();
			observer.disconnect();
			seen.disconnect();
			dark.removeEventListener('change', theme);
			host.removeEventListener('pointermove', pointer);
			host.removeEventListener('pointerdown', pointer);
			host.removeEventListener('pointerleave', leave);
			host.removeEventListener('touchmove', touch);
			host.removeEventListener('touchend', leave);
		};
	});
</script>

<section bind:this={section} class="relative isolate overflow-clip {extra}">
	<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
		<canvas
			bind:this={canvas}
			class="absolute top-0 left-0 [image-rendering:pixelated]"
			data-testid="field"
			data-shape={shape}
		></canvas>
		<div class="absolute inset-0 {shape === 'chart' ? 'chart-cuts' : 'site-cuts'}"></div>
	</div>
	{@render children()}
</section>
