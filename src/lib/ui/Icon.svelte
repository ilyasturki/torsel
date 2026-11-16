<script lang="ts" module>
	const PATHS = {
		plus: 'M8 3v10M3 8h10',
		sync: 'M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M11.6 2v2.5H9.1M4.4 14v-2.5h2.5',
		warn: 'M8 2.5l6 11H2zM8 6.5v3.5M8 11.75v.01',
		minus: 'M3 8h10',
		x: 'M4 4l8 8M12 4l-8 8',
		check: 'M3 8.5l3.5 3.5L13 4.5',
		more: 'M3 8h.01M8 8h.01M13 8h.01',
		chevron: 'M6 4l4 4-4 4',
		'chevron-down': 'M4 6l4 4 4-4',
		'arrow-up': 'M8 13V3M4 7l4-4 4 4',
		'arrow-down': 'M8 3v10M4 9l4 4 4-4',
		'arrow-left': 'M13 8H3M7 4L3 8l4 4',
		'arrow-right': 'M3 8h10M9 4l4 4-4 4',
		open: 'M4.5 11.5l7-7M6 4.5h5.5V10',
		attach: 'M10.5 5.5L6 10a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4L4 8a4.2 4.2 0 0 0 6 6l3.5-3.5',
		pencil: 'M10 3.5l2.5 2.5M3 13l.5-2.5L11 3a1.4 1.4 0 0 1 2 2l-7.5 7.5z',
		send: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
		eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
		'eye-off':
			'M2 2l12 12M6.5 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-2 2.6M4.3 5A12 12 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.8-.7',
		fit: 'M2.5 3v10M13.5 3v10M5 8h6M7 6L5 8l2 2M9 6l2 2-2 2',
		copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
		lock: 'M3.5 7.5h9v6h-9zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
		settings: 'M2.5 4.5h11M2.5 11.5h11M5.5 3v3M10.5 10v3',
		search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.5 10.5l3 3',
		bookmark: 'M4 2.5h8v11l-4-3-4 3z',
		spark: 'M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z',
		text: 'M3 3.5h10M8 3.5v9',
		'long-text': 'M2.5 4h11M2.5 8h11M2.5 12h6',
		number: 'M6.5 2.5l-1.5 11M11 2.5l-1.5 11M3 6h10.5M2.5 10h10.5',
		currency: 'M1.5 4h13v8h-13zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM4 8h.01M12 8h.01',
		percent:
			'M12.5 3.5l-9 9M5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
		rating: 'M8 2l1.8 3.8 4.2.6-3 2.9.7 4.2L8 11.5l-3.7 2 .7-4.2-3-2.9 4.2-.6z',
		date: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2v3M10.5 2v3',
		'date-time':
			'M13.5 7.5V4h-11v9.5h5M2.5 7h11M5.5 2v3M10.5 2v3M11.5 9a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM11.5 10.5V12h1',
		duration: 'M8 4a4.75 4.75 0 1 0 0 9.5A4.75 4.75 0 0 0 8 4zM8 6.5V9l1.5 1.5M6 1.5h4',
		choice: 'M2 4h12v8H2zM6 7l2 2 2-2',
		choices: 'M2.5 3h3v3h-3zM2.5 10h3v3h-3zM8 4.5h5.5M8 11.5h5.5',
		checkbox: 'M2.5 2.5h11v11h-11zM5 8l2 2 4-4',
		link: 'M2.5 2.5H7V7H2.5zM9 9h4.5v4.5H9zM4.75 7v4.25H9',
		formula: 'M11.5 2.5H10A1.5 1.5 0 0 0 8.5 4v8A1.5 1.5 0 0 1 7 13.5H5.5M5.5 7h5',
		url: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1',
		email: 'M1.5 3.5h13v9h-13zM1.5 4l6.5 5 6.5-5',
		phone: 'M4.5 1.5h7v13h-7zM7 12h2',
		image: 'M2.5 2.5h11v11h-11zM2.5 11l3.5-3.5 3 3 1.5-1.5 3 3M10 5.5h.01',
		'image-off': 'M2 2l12 12M13.5 10V2.5H6M2.5 4.5v9h9M2.5 11l3.5-3.5 2 2',
		camera: 'M1.5 4.5h3l1.5-2h4l1.5 2h3v9h-13zM8 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
		'view-grid': 'M2.5 2.5h11v11h-11zM2.5 6.5h11M2.5 10h11M6.5 2.5v11',
		'view-entry': 'M2.5 2.5h11v11h-11zM8 5.5v5M5.5 8h5',
		'view-list': 'M2.5 4h1M6 4h7.5M2.5 8h1M6 8h7.5M2.5 12h1M6 12h7.5',
		'view-chart': 'M3.5 13.5V9M8 13.5V3M12.5 13.5V6.5'
	} as const;

	export const ICONS = Object.keys(PATHS) as IconName[];

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
