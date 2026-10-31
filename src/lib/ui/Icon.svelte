<script lang="ts" module>
	const PATHS = {
		plus: 'M8 3v10M3 8h10',
		minus: 'M3 8h10',
		x: 'M4 4l8 8M12 4l-8 8',
		check: 'M3 8.5l3.5 3.5L13 4.5',
		more: 'M3 8h.01M8 8h.01M13 8h.01',
		chevron: 'M6 4l4 4-4 4',
		'arrow-up': 'M8 13V3M4 7l4-4 4 4',
		'arrow-down': 'M8 3v10M4 9l4 4 4-4',
		'arrow-left': 'M13 8H3M7 4L3 8l4 4',
		'arrow-right': 'M3 8h10M9 4l4 4-4 4',
		undo: 'M5.5 3.5L3 6l2.5 2.5M3 6h6.5a3 3 0 0 1 0 6H6',
		redo: 'M10.5 3.5L13 6l-2.5 2.5M13 6H6.5a3 3 0 0 0 0 6H10',
		eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
		'eye-off':
			'M2 2l12 12M6.5 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-2 2.6M4.3 5A12 12 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.8-.7'
	} as const;

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let {
		name,
		label,
		class: extra = 'size-4'
	}: { name: IconName; label?: string; class?: string } = $props();
</script>

<svg
	viewBox="0 0 16 16"
	class="shrink-0 {extra}"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="square"
	role={label === undefined ? undefined : 'img'}
	aria-label={label}
	aria-hidden={label === undefined}
>
	<path d={PATHS[name]} />
</svg>
