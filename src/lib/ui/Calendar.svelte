<script lang="ts">
	import { tick, untrack } from 'svelte';

	import { pad, todayIso } from '#lib/core/values.ts';
	import { formatLocale } from '#lib/i18n/runtime.ts';
	import { ui as words } from '#lib/i18n/ui.ts';

	import Icon from './Icon.svelte';
	import { chip, chipOff, focus } from './styles.ts';

	let {
		value,
		onpick,
		large = false
	}: {
		/** The day picked, as an ISO date; a time after it is ignored here. */
		value: string | null;
		onpick: (day: string) => void;
		large?: boolean;
	} = $props();

	const WEEKS = 6;

	const iso = (date: Date): string =>
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const dayOf = (text: string): Date => {
		const [year, month, day] = text.slice(0, 10).split('-').map(Number);
		return new Date(year, month - 1, day);
	};
	const shifted = (date: Date, days: number): Date =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

	const today = todayIso();
	const picked = $derived(
		value !== null && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null
	);

	const locale = formatLocale();
	const weekStart = (() => {
		const info = new Intl.Locale(locale) as Intl.Locale & {
			getWeekInfo?: () => { firstDay: number };
			weekInfo?: { firstDay: number };
		};
		return (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay ?? 1;
	})();
	const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
	const fullDay = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
	const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });

	let month = $state(untrack(() => dayOf(picked ?? today)));
	let active = $state(untrack(() => picked ?? today));
	let grid = $state<HTMLElement>();

	$effect(() => {
		const day = picked;
		if (day === null) return;
		untrack(() => {
			active = day;
			const at = dayOf(day);
			if (at.getFullYear() !== month.getFullYear() || at.getMonth() !== month.getMonth()) {
				month = new Date(at.getFullYear(), at.getMonth(), 1);
			}
		});
	});

	const days = $derived.by(() => {
		const first = new Date(month.getFullYear(), month.getMonth(), 1);
		const start = shifted(first, -((first.getDay() - (weekStart % 7) + 7) % 7));
		return Array.from({ length: WEEKS * 7 }, (_, at) => shifted(start, at));
	});

	const heads = $derived(days.slice(0, 7).map((date) => weekday.format(date).replace(/\.$/u, '')));

	function turn(by: number): void {
		month = new Date(month.getFullYear(), month.getMonth() + by, 1);
	}

	async function move(to: Date): Promise<void> {
		active = iso(to);
		if (to.getMonth() !== month.getMonth() || to.getFullYear() !== month.getFullYear()) {
			month = new Date(to.getFullYear(), to.getMonth(), 1);
		}
		await tick();
		grid?.querySelector<HTMLElement>(`[data-day="${active}"]`)?.focus();
	}

	function onkeydown(event: KeyboardEvent): void {
		const from = dayOf(active);
		const steps: Record<string, () => Date> = {
			ArrowLeft: () => shifted(from, -1),
			ArrowRight: () => shifted(from, 1),
			ArrowUp: () => shifted(from, -7),
			ArrowDown: () => shifted(from, 7),
			PageUp: () => new Date(from.getFullYear(), from.getMonth() - 1, from.getDate()),
			PageDown: () => new Date(from.getFullYear(), from.getMonth() + 1, from.getDate())
		};
		const step = steps[event.key];
		if (step === undefined) return;
		event.preventDefault();
		void move(step());
	}

	const tabbable = $derived(days.some((date) => iso(date) === active) ? active : iso(days[7]));

	const shortcuts = $derived([
		{ label: words.yesterday, day: iso(shifted(dayOf(today), -1)) },
		{ label: words.today, day: today },
		{ label: words.tomorrow, day: iso(shifted(dayOf(today), 1)) }
	]);
</script>

<div data-calendar class="flex flex-col gap-2 {large ? 'text-lg' : ''}">
	<div class="grid grid-cols-3 gap-1">
		{#each shortcuts as shortcut (shortcut.day)}
			<button
				type="button"
				class="{chip} {chipOff} justify-center px-2 {large ? 'h-11' : ''} {picked === shortcut.day
					? 'text-ink ring-1 ring-edge ring-inset'
					: ''}"
				onclick={() => onpick(shortcut.day)}>{shortcut.label}</button
			>
		{/each}
	</div>
	<div class="flex items-center gap-1 pl-2">
		<span class="min-w-0 flex-1 truncate font-semibold capitalize" aria-live="polite"
			>{monthName.format(month)}</span
		>
		<button
			type="button"
			class="flex motion {large
				? 'size-11'
				: 'size-control'} items-center justify-center rounded-box text-ink-2 transition-colors hover:bg-tint-2 hover:text-ink {focus}"
			aria-label={words.previousMonth}
			onclick={() => turn(-1)}
		>
			<Icon name="chevron" class="size-4 rotate-180" />
		</button>
		<button
			type="button"
			class="flex motion {large
				? 'size-11'
				: 'size-control'} items-center justify-center rounded-box text-ink-2 transition-colors hover:bg-tint-2 hover:text-ink {focus}"
			aria-label={words.nextMonth}
			onclick={() => turn(1)}
		>
			<Icon name="chevron" class="size-4" />
		</button>
	</div>
	<div
		bind:this={grid}
		class="grid grid-cols-7 gap-0.5"
		role="group"
		aria-label={monthName.format(month)}
	>
		{#each heads as head, at (at)}
			<span class="flex h-6 items-center justify-center text-xs text-ink-3" aria-hidden="true"
				>{head}</span
			>
		{/each}
		{#each days as date (iso(date))}
			{@const day = iso(date)}
			{@const outside = date.getMonth() !== month.getMonth()}
			<button
				type="button"
				data-day={day}
				tabindex={day === tabbable ? 0 : -1}
				aria-label={fullDay.format(date)}
				aria-pressed={day === picked}
				aria-current={day === today ? 'date' : undefined}
				class="flex motion {large
					? 'h-11'
					: 'h-control'} items-center justify-center rounded-box tabular-nums transition-colors {focus} {day ===
				picked
					? 'bg-accent font-semibold text-on-accent'
					: `hover:bg-tint-2 ${outside ? 'text-ink-3' : 'text-ink'}`} {day === today &&
				day !== picked
					? 'ring-1 ring-edge ring-inset'
					: ''}"
				onclick={() => onpick(day)}
				{onkeydown}>{date.getDate()}</button
			>
		{/each}
	</div>
</div>
