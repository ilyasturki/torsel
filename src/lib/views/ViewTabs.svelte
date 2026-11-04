<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { tick } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords } from '#lib/core/actions.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import ContextMenu from '#lib/ui/ContextMenu.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import { focus } from '#lib/ui/styles.ts';

	import { VIEW_TYPES, addView, moveView } from './views.ts';

	let {
		table,
		views,
		current,
		onsettings
	}: {
		table: TableDef;
		views: ViewDef[];
		current: ViewDef | undefined;
		onsettings: (viewId: string) => void;
	} = $props();

	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);
	const HOLD = 250;

	let strip: HTMLElement | undefined = $state();
	let drag = $state<{ id: string; from: number; to: number; dx: number; width: number } | null>(
		null
	);
	let press: {
		id: string;
		from: number;
		x: number;
		y: number;
		touch: boolean;
		armed: boolean;
		timer: ReturnType<typeof setTimeout> | undefined;
		centers: number[];
		width: number;
	} | null = null;
	let swallowClick = false;

	function tabs(): HTMLElement[] {
		return strip === undefined ? [] : [...strip.querySelectorAll<HTMLElement>('[data-view]')];
	}

	function begin(event: PointerEvent, view: ViewDef, at: number): void {
		if (event.button !== 0 || views.length < 2) return;
		const all = tabs();
		const own = all[at];
		press = {
			id: view.id,
			from: at,
			x: event.clientX,
			y: event.clientY,
			touch: event.pointerType !== 'mouse',
			armed: event.pointerType === 'mouse',
			timer: undefined,
			centers: all.map((tab) => tab.offsetLeft + tab.offsetWidth / 2),
			width: own?.offsetWidth ?? 0
		};
		if (press.touch) {
			press.timer = setTimeout(() => {
				if (press !== null) press.armed = true;
			}, HOLD);
		}
		window.addEventListener('pointermove', follow);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
	}

	function follow(event: PointerEvent): void {
		if (press === null) return;
		const dx = event.clientX - press.x;
		const moved = Math.hypot(dx, event.clientY - press.y);
		if (drag === null) {
			if (!press.armed) {
				if (moved > 8) end();
				return;
			}
			if (moved < 4) return;
			drag = { id: press.id, from: press.from, to: press.from, dx: 0, width: press.width };
		}
		const center = press.centers[press.from] + dx;
		let to = 0;
		for (const [at, mid] of press.centers.entries()) {
			if (at !== press.from && center > mid) to += 1;
		}
		drag = { ...drag, dx, to };
	}

	function end(): void {
		if (press?.timer !== undefined) clearTimeout(press.timer);
		window.removeEventListener('pointermove', follow);
		window.removeEventListener('pointerup', end);
		window.removeEventListener('pointercancel', end);
		const done = drag;
		press = null;
		drag = null;
		if (done !== null) {
			swallowClick = true;
			setTimeout(() => (swallowClick = false), 0);
			if (done.to !== done.from) void moveView(table.id, done.id, done.to, current?.id);
		}
	}

	function holdTouch(node: HTMLElement): { destroy(): void } {
		const stop = (event: TouchEvent): void => {
			if (drag !== null) event.preventDefault();
		};
		node.addEventListener('touchmove', stop, { passive: false });
		return { destroy: () => node.removeEventListener('touchmove', stop) };
	}

	function shift(at: number): string {
		if (drag === null) return '';
		if (at === drag.from) return `transform: translateX(${drag.dx}px)`;
		if (drag.to > drag.from && at > drag.from && at <= drag.to) {
			return `transform: translateX(-${drag.width}px)`;
		}
		if (drag.to < drag.from && at < drag.from && at >= drag.to) {
			return `transform: translateX(${drag.width}px)`;
		}
		return '';
	}

	async function move(view: ViewDef, to: number): Promise<void> {
		await moveView(table.id, view.id, to, current?.id);
		await tick();
		strip?.querySelector<HTMLElement>(`[data-view="${view.id}"]`)?.focus();
	}

	function onkeydown(event: KeyboardEvent, view: ViewDef, at: number): void {
		const command = mac ? event.metaKey : event.ctrlKey;
		if (!command || !event.shiftKey) return;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			void move(view, at + (event.key === 'ArrowLeft' ? -1 : 1));
		}
	}

	function remove(view: ViewDef): void {
		const label = `View "${view.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [view.id]), label);
		showToast(label, group?.id ?? null);
		if (view.id === current?.id) void goto(tableUrl(table.id));
	}

	function slide(node: HTMLElement): { destroy(): void } {
		const indicator = node.querySelector<HTMLElement>('[data-indicator]');
		const place = (): void => {
			const on = node.querySelector<HTMLElement>('[aria-current="page"]');
			if (indicator === null) return;
			indicator.style.opacity = on === null ? '0' : '1';
			if (on !== null) {
				indicator.style.width = `${on.offsetWidth}px`;
				indicator.style.transform = `translateX(${on.offsetLeft}px)`;
				node.scrollTo({ left: on.offsetLeft - (node.clientWidth - on.offsetWidth) / 2 });
			}
		};
		const mutations = new MutationObserver(place);
		mutations.observe(node, { subtree: true, childList: true, attributeFilter: ['aria-current'] });
		const sizes = new ResizeObserver(place);
		sizes.observe(node);
		place();
		return {
			destroy() {
				mutations.disconnect();
				sizes.disconnect();
			}
		};
	}

	const keys = mac ? '⇧⌘' : 'Ctrl+Shift+';
</script>

<div class="flex min-w-0 items-center gap-1 max-sm:flex-1">
	<div
		bind:this={strip}
		class="relative flex min-w-0 hide-scrollbar overflow-x-auto"
		role="group"
		aria-label="Views"
		use:slide
		use:holdTouch
	>
		<i
			data-indicator
			class="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-ink transition-[transform,width] motion-slow {drag
				? 'opacity-0'
				: ''}"
		></i>
		{#each views as view, at (view.id)}
			<ContextMenu label={view.name}>
				{#snippet target(props)}
					<a
						{...mergeProps(props, {
							onpointerdown: (event: PointerEvent) => begin(event, view, at),
							onkeydown: (event: KeyboardEvent) => onkeydown(event, view, at),
							onclick: (event: MouseEvent) => {
								if (swallowClick) event.preventDefault();
							}
						})}
						href={tableUrl(table.id, view.id)}
						draggable="false"
						data-view={view.id}
						aria-current={view.id === current?.id ? 'page' : undefined}
						class="relative flex h-10 shrink-0 items-center rounded-box px-3 font-medium whitespace-nowrap select-none hover:text-ink {focus} {view.id ===
						current?.id
							? 'text-ink'
							: 'text-ink-2'} {drag?.id === view.id
							? 'z-10 bg-raised shadow-float'
							: drag
								? 'transition-transform motion'
								: 'transition-colors motion'}"
						style={shift(at)}>{view.name}</a
					>
				{/snippet}
				<MenuItem icon="settings" onSelect={() => onsettings(view.id)}>View settings</MenuItem>
				<MenuItem
					icon="arrow-left"
					shortcut="{keys}←"
					disabled={at === 0}
					onSelect={() => void move(view, at - 1)}>Move left</MenuItem
				>
				<MenuItem
					icon="arrow-right"
					shortcut="{keys}→"
					disabled={at === views.length - 1}
					onSelect={() => void move(view, at + 1)}>Move right</MenuItem
				>
				<MenuSeparator />
				<MenuItem icon="x" onSelect={() => remove(view)}>Delete view</MenuItem>
			</ContextMenu>
		{/each}
	</div>
	<span class="max-sm:hidden">
		<Menu label="New view">
			{#snippet trigger(props)}
				<IconButton {...props} icon="plus" label="New view" tooltip={false} />
			{/snippet}
			{#each VIEW_TYPES as option (option.id)}
				<MenuItem icon={option.icon} onSelect={() => addView(table.id, option.id)}
					>{option.label}</MenuItem
				>
			{/each}
		</Menu>
	</span>
</div>
