<script lang="ts" module>
	const PATHS = {
		plus: 'M8 3v10M3 8h10',
		minus: 'M3 8h10',
		x: 'M4 4l8 8M12 4l-8 8',
		check: 'M3 8.5l3.5 3.5L13 4.5',
		more: 'M3 8h.01M8 8h.01M13 8h.01',
		'arrow-up': 'M8 13V3M4 7l4-4 4 4',
		'arrow-down': 'M8 3v10M4 9l4 4 4-4'
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
