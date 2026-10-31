<script lang="ts">
	import { onMount } from 'svelte';

	import { BAND_VIEWS, CellBand } from './band.ts';
	import { sampleYear } from './year.ts';

	let canvas = $state<HTMLCanvasElement>();
	let selected = $state('all');
	let band: CellBand | null = null;
	let tip = $state<{ text: string; detail: string; left: number; top: number } | null>(null);

	function pick(id: string): void {
		selected = id;
		tip = null;
		band?.go(id);
	}

	function pointer(event: PointerEvent): void {
		if (band === null || canvas === undefined) return;
		const box = canvas.getBoundingClientRect();
		const cell = band.cellAt(event.clientX - box.left, event.clientY - box.top);
		band.hovered = cell;
		band.schedule();
		tip =
			cell === null
				? null
				: {
						text: cell.text(),
						detail: cell.detail(),
						left: Math.min(innerWidth - 180, Math.max(8, box.left + cell.x - 60)),
						top: box.top + cell.y < 70 ? box.top + cell.y + cell.size + 8 : box.top + cell.y - 52
					};
	}

	function leave(): void {
		tip = null;
		if (band !== null) {
			band.hovered = null;
			band.schedule();
		}
	}

	onMount(() => {
		if (canvas === undefined) return;
		const target = canvas;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const dark = matchMedia('(prefers-color-scheme: dark)');
		let lastWidth = innerWidth;
		const resize = (): void => {
			if (innerWidth === lastWidth) return;
			lastWidth = innerWidth;
			band?.resize();
		};
		const theme = (): void => band?.readColors();

		// Its thousands of rows are built only when the band comes near: they would otherwise be the longest task on load.
		const near = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting) return;
				near.disconnect();
				band = new CellBand(target, sampleYear(), reduced);
				band.go(selected);
			},
			{ rootMargin: '400px 0px' }
		);
		near.observe(target);
		addEventListener('resize', resize);
		addEventListener('scroll', leave, { passive: true });
		dark.addEventListener('change', theme);
		return () => {
			near.disconnect();
			removeEventListener('resize', resize);
			removeEventListener('scroll', leave);
			dark.removeEventListener('change', theme);
		};
	});
</script>

<div
	class="flex hide-scrollbar gap-1 overflow-x-auto px-4 lg:px-6"
	role="group"
	aria-label="Tables"
>
	{#each BAND_VIEWS as view (view.id)}
		<button
			type="button"
			class="h-8 shrink-0 rounded-box px-3 font-semibold transition-colors motion {selected ===
			view.id
				? 'bg-fill text-on-fill'
				: 'bg-tint text-ink-2 hover:bg-tint-2 hover:text-ink'}"
			aria-pressed={selected === view.id}
			onclick={() => pick(view.id)}>{view.label}</button
		>
	{/each}
</div>
<div class="relative mt-2 h-band">
	<canvas
		bind:this={canvas}
		class="absolute inset-0 block size-full touch-pan-y"
		aria-label="A sample year of rows from six tables"
		data-testid="year-band"
		onpointermove={pointer}
		onpointerdown={pointer}
		onpointerleave={leave}
	></canvas>
</div>
{#if tip !== null}
	<div
		class="pointer-events-none fixed z-40 rounded-panel bg-float px-2.5 py-1.5 text-sm shadow-float"
		style="left: {tip.left}px; top: {tip.top}px"
		role="status"
	>
		<span class="block font-medium">{tip.text}</span>
		<span class="block text-ink-3">{tip.detail}</span>
	</div>
{/if}
