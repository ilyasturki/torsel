<script lang="ts">
	import { onMount } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import type { ThreadAction } from '#lib/core/thread.ts';
	import { holdAnchor } from '#lib/dev/anchor.ts';
	import { seedFixture, type Fixture } from '#lib/dev/fixtures.ts';
	import Section from '#lib/dev/Section.svelte';
	import Specimen from '#lib/dev/Specimen.svelte';
	import { forceTheme, type Theme } from '#lib/dev/theme.ts';
	import AffixInput from '#lib/ui/AffixInput.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipPicker from '#lib/ui/ChipPicker.svelte';
	import CodeInput from '#lib/ui/CodeInput.svelte';
	import { DATA_COLORS } from '#lib/ui/colors.ts';
	import ContextMenu from '#lib/ui/ContextMenu.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import { FIELD_ICON_TYPES, fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon, { ICONS } from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import Markdown from '#lib/ui/Markdown.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';
	import PasswordInput from '#lib/ui/PasswordInput.svelte';
	import Rating from '#lib/ui/Rating.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import Select, { type Option } from '#lib/ui/Select.svelte';
	import Spark from '#lib/ui/Spark.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import {
		checkbox,
		fieldFill,
		fieldFocusWithin,
		input,
		secondary,
		textarea
	} from '#lib/ui/styles.ts';
	import Tally from '#lib/ui/Tally.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import CellValue from '#lib/views/CellValue.svelte';
	import ChangeCard from '#lib/views/ChangeCard.svelte';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import FieldInput from '#lib/views/FieldInput.svelte';
	import FieldSheet from '#lib/views/FieldSheet.svelte';
	import { typeOptions } from '#lib/views/field-types.ts';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';
	import RowSheet from '#lib/views/RowSheet.svelte';
	import Toast from '#lib/views/Toast.svelte';
	import ViewSheet from '#lib/views/ViewSheet.svelte';

	const NAV: { group: string; names: string[] }[] = [
		{
			group: 'Tokens',
			names: ['Colors', 'Data colors', 'Type', 'Sizes', 'Corners', 'Elevation', 'Motion']
		},
		{
			group: 'Primitives',
			names: [
				'Button',
				'IconButton',
				'Tooltip',
				'Icon',
				'Field icons',
				'Fields',
				'Textarea',
				'AffixInput',
				'Select',
				'Rating',
				'ChipPicker',
				'Menu',
				'ContextMenu',
				'Dialog',
				'Segmented',
				'Stepper',
				'PasswordInput',
				'CodeInput',
				'Chip',
				'Spark',
				'Tally',
				'Empty',
				'Markdown',
				'Logo'
			]
		},
		{
			group: 'Views',
			names: [
				'CellValue',
				'FieldInput',
				'Grid',
				'Entry',
				'List',
				'Chart',
				'RowSheet',
				'FieldSheet',
				'ViewSheet',
				'Toast',
				'ChangeCard'
			]
		}
	];

	const anchor = (name: string): string => `#${name.toLowerCase().replaceAll(' ', '-')}`;

	const COLORS = [
		'canvas',
		'raised',
		'float',
		'tint',
		'tint-2',
		'hair',
		'edge',
		'field',
		'field-hover',
		'button',
		'button-hover',
		'field-edge',
		'selected',
		'ink',
		'ink-2',
		'ink-3',
		'fill',
		'on-fill',
		'scrim',
		'focus'
	];

	const TYPE = [
		{ name: 'text-xs', class: 'text-xs' },
		{ name: 'text-sm', class: 'text-sm' },
		{ name: 'text-base', class: 'text-base' },
		{ name: 'text-base font-medium', class: 'text-base font-medium' },
		{ name: 'text-base font-semibold', class: 'text-base font-semibold' },
		{ name: 'text-lg font-semibold', class: 'text-lg font-semibold tight' },
		{ name: 'text-xl font-semibold', class: 'text-xl font-semibold tight' },
		{ name: 'text-2xl font-semibold', class: 'text-2xl font-semibold tighter' }
	];

	const SIZES = [
		{ name: 'size-mark', class: 'size-mark' },
		{ name: 'h-control', class: 'h-control w-24' },
		{ name: 'h-row', class: 'h-row w-24' },
		{ name: 'h-cta', class: 'h-cta w-24' },
		{ name: 'w-gutter', class: 'h-4 w-gutter' }
	];

	const MOTION = ['--fast', '--mid', '--slow', '--ease'];

	let theme = $state<Theme>(null);
	let values = $state<Record<string, string>>({});
	let fixture = $state<Fixture | null>(null);
	let replay = $state(0);

	let order = $state<'asc' | 'desc'>('asc');
	let field = $state('');
	let session = $state('Legs');
	let none = $state('');
	let note = $state('Sets of five, then\na back-off set of eight.\nRest 3 minutes.');
	let composer = $state('');
	let text = $state('Squat');
	let password = $state('not-a-real-password');
	let code = $state('');
	let kg = $state('102.5');
	let dialogOpen = $state(false);
	let dirtyName = $state('');
	let rowOpen = $state(false);
	let newRowOpen = $state(false);
	let fieldOpen = $state(false);
	let viewOpen = $state(false);
	let menuChoice = $state('Nothing picked yet');
	let segment = $state('grid');

	const MANY: Option[] = [
		'Date',
		'Exercise',
		'Session',
		'Kg',
		'Reps',
		'Done',
		'Notes',
		'Volume',
		'Rest',
		'Tempo',
		'Bodyweight',
		'Mood'
	].map((name, index) => ({
		value: name.toLowerCase(),
		label: name,
		icon: fieldIcon(
			[
				'date',
				'link',
				'choice',
				'number',
				'number',
				'check',
				'text',
				'formula',
				'duration',
				'text',
				'number',
				'rating'
			][index]
		)
	}));

	const SESSIONS: Option[] = [
		{ value: 'Push', label: 'Push', color: 'orange' },
		{ value: 'Pull', label: 'Pull', color: 'blue' },
		{ value: 'Legs', label: 'Legs', color: 'green' }
	];

	const MARKDOWN = [
		'### Last week',
		'You squatted **3 times**, up `2.5 kg` each session.',
		'',
		'- Squat: 105 kg × 4',
		'- Bench press: 75 kg × 6',
		'',
		'| Exercise | Best |',
		'| --- | --- |',
		'| Squat | 105 |',
		'| Deadlift | 140 |'
	].join('\n');

	/** One of each kind of change, on the sample table: rows added, a value changed, a field gone, one undone. */
	const changes = $derived.by((): ThreadAction[] => {
		void app.version;
		if (fixture === null) return [];
		const tableId = fixture.table;
		const all = app.ws.fields(tableId);
		const text = all.find((item) => item.type === 'text');
		const number = all.find((item) => item.type === 'number');
		const row = app.ws.live(fixture.rows[0]);
		const gone = all.at(-1);
		if (text === undefined || number === undefined || row === undefined || gone === undefined) {
			return [];
		}
		const base = row.base;
		const added = { id: 'r_devui_added', kind: 'row' as const, base, parent: tableId };
		const edit = { id: row.id, kind: 'row' as const, base, parent: tableId };
		const field = { id: gone.id, kind: 'field' as const, base, parent: tableId };
		const before = row.data[number.id] ?? null;
		const after = typeof before === 'number' ? before + 5 : 100;
		const goneRec = app.ws.get(gone.id);
		return [
			{
				id: 'added',
				turn: 1,
				summary: 'Add 1 row to Sets',
				changes: [{ ...added, set: { [text.id]: 'Deadlift', [number.id]: 140 } }],
				before: [{ ...added, set: { _del: true } }],
				status: 'applied'
			},
			{
				id: 'edited',
				turn: 1,
				summary: 'Change 1 row in Sets',
				changes: [{ ...edit, set: { [number.id]: after } }],
				before: [{ ...edit, set: { [number.id]: before } }],
				status: 'applied'
			},
			{
				id: 'gone',
				turn: 2,
				summary: `Delete field "${gone.name}"`,
				changes: [{ ...field, set: { _del: true } }],
				before: [{ ...field, set: { ...goneRec?.data, _del: null } }],
				status: 'applied'
			},
			{
				id: 'undone',
				turn: 3,
				summary: 'Change 1 row in Sets',
				changes: [{ ...edit, set: { [number.id]: after } }],
				before: [{ ...edit, set: { [number.id]: before } }],
				status: 'undone'
			}
		];
	});

	const fields = $derived.by(() => {
		void app.version;
		return fixture === null ? [] : app.ws.fields(fixture.table);
	});

	const typed = $derived.by(() => {
		void app.version;
		if (fixture === null) return { fields: [], row: undefined, computed: undefined };
		const { table, row } = fixture.types;
		return {
			fields: app.ws.fields(table),
			row: app.ws.live(row),
			computed: app.computed(table).get(row)
		};
	});

	let fieldType = $state('rating');
	let typesOpen = $state(false);
	let stars = $state<number | null>(3);
	let halves = $state<number | null>(7.5);
	let tags = $state(['Strength']);
	let amount = $state('49.90');

	const view = (id: string | undefined) => {
		void app.version;
		return id === undefined ? undefined : app.ws.view(id);
	};

	function readTokens(): void {
		const style = getComputedStyle(document.documentElement);
		values = Object.fromEntries(
			[
				...COLORS,
				...MOTION,
				...DATA_COLORS.flatMap((color) => [`d-${color}`, `d-${color}-bg`])
			].map((name) => {
				const property = name.startsWith('--') ? name : `--${name}`;
				return [name, style.getPropertyValue(property).trim()];
			})
		);
	}

	function pickTheme(next: Theme): void {
		theme = next;
		forceTheme(next);
		requestAnimationFrame(readTokens);
	}

	onMount(() => {
		readTokens();
		const release = holdAnchor();
		const dark = matchMedia('(prefers-color-scheme: dark)');
		dark.addEventListener('change', readTokens);

		let made: Fixture | null = null;
		void app
			.openSample((ws, commit) => {
				made = seedFixture(ws, commit);
			})
			.then(() => {
				fixture = made;
			});

		return () => {
			release();
			dark.removeEventListener('change', readTokens);
			forceTheme(null);
		};
	});
</script>

<svelte:head>
	<title>Design system | Torsel</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="mx-auto flex max-w-page-gapped gap-10 px-gutter lg:px-10">
	<nav
		class="sticky top-0 hidden h-dvh w-48 shrink-0 flex-col gap-5 overflow-y-auto py-8 lg:flex"
		aria-label="Sections"
	>
		{#each NAV as group (group.group)}
			<div class="flex flex-col gap-1">
				<span class="text-xs font-medium text-ink-3">{group.group}</span>
				{#each group.names as name (name)}
					<a href={anchor(name)} class="text-sm text-ink-2 transition-colors motion hover:text-ink"
						>{name}</a
					>
				{/each}
			</div>
		{/each}
	</nav>

	<main class="min-w-0 flex-1 py-8">
		<header class="flex flex-wrap items-center gap-4 pb-4">
			<Logo wordmark class="h-4" />
			<h1 class="flex-1 text-xl font-semibold tight">Design system</h1>
			<Segmented
				label="Theme"
				items={[
					{ id: 'system', label: 'System', active: theme === null, onclick: () => pickTheme(null) },
					{
						id: 'light',
						label: 'Light',
						active: theme === 'light',
						onclick: () => pickTheme('light')
					},
					{ id: 'dark', label: 'Dark', active: theme === 'dark', onclick: () => pickTheme('dark') }
				]}
			/>
		</header>

		<Section name="Colors" from="app.css">
			{#each COLORS as name (name)}
				<Specimen label="--{name}">
					<span class="block h-12 w-28 rounded-box shadow-raised" style="background: var(--{name})"
					></span>
					<span class="font-mono text-xs text-ink-2">{values[name]}</span>
				</Specimen>
			{/each}
		</Section>

		<Section name="Data colors" from="ui/colors.ts">
			{#each DATA_COLORS as color (color)}
				<Specimen label={color}>
					<span class="flex gap-1">
						<span class="block size-control rounded-box" style="background: var(--d-{color})"
						></span>
						<span
							class="flex h-control items-center rounded-box px-2 font-medium"
							style="background: var(--d-{color}-bg); color: var(--d-{color}-fg)">{color}</span
						>
					</span>
					<span class="font-mono text-xs text-ink-2">{values[`d-${color}`]}</span>
				</Specimen>
			{/each}
		</Section>

		<Section name="Type" from="app.css">
			<div class="flex w-full flex-col gap-3">
				{#each TYPE as size (size.name)}
					<Specimen label={size.name} wide>
						<span class={size.class}>Squat 105 kg × 4, Oct 31</span>
					</Specimen>
				{/each}
				<Specimen label="text-ink-2, text-ink-3" wide>
					<span class="flex gap-4"
						><span class="text-ink-2">Secondary</span><span class="text-ink-3">Tertiary</span></span
					>
				</Specimen>
			</div>
		</Section>

		<Section name="Sizes" from="app.css">
			{#each SIZES as size (size.name)}
				<Specimen label={size.name}>
					<span class="block rounded-box bg-tint-2 {size.class}"></span>
				</Specimen>
			{/each}
		</Section>

		<Section name="Corners" from="app.css">
			<Specimen label="rounded-box">
				<span class="block size-16 rounded-box bg-tint-2"></span>
			</Specimen>
			<Specimen label="rounded-panel">
				<span class="block size-16 rounded-panel bg-tint-2"></span>
			</Specimen>
		</Section>

		<Section name="Elevation" from="app.css">
			<Specimen label="bg-raised shadow-raised">
				<span class="block h-16 w-32 rounded-panel bg-raised shadow-raised"></span>
			</Specimen>
			<Specimen label="bg-float shadow-float">
				<span class="block h-16 w-32 rounded-panel bg-float shadow-float"></span>
			</Specimen>
		</Section>

		<Section name="Motion" from="app.css">
			{#each MOTION as name (name)}
				<Specimen label={name}>
					<span class="font-mono text-sm">{values[name]}</span>
				</Specimen>
			{/each}
			<Specimen label="enter">
				<div class="flex items-center gap-3">
					<Button onclick={() => (replay += 1)}>Play</Button>
					{#key replay}
						<span class="block h-control w-24 enter rounded-box bg-tint-2"></span>
					{/key}
				</div>
			</Specimen>
		</Section>

		<Section name="Button" from="ui/Button.svelte">
			{#each ['primary', 'secondary', 'ghost'] as const as variant (variant)}
				<Specimen label="variant={variant}">
					<Button {variant}>Save</Button>
				</Specimen>
				<Specimen label="{variant} disabled">
					<Button {variant} disabled>Save</Button>
				</Specimen>
			{/each}
			<Specimen label="ghost aria-pressed">
				<Button variant="ghost" aria-pressed="true" class="bg-tint-2 text-ink">Threads</Button>
			</Specimen>
			<Specimen label="with an icon">
				<Button variant="primary"><Icon name="plus" />New row</Button>
			</Specimen>
			<Specimen label="size=cta">
				<Button variant="primary" size="cta">Add set</Button>
			</Specimen>
		</Section>

		<Section name="IconButton" from="ui/IconButton.svelte">
			<Specimen label="ghost">
				<IconButton icon="more" label="More" />
			</Specimen>
			<Specimen label="secondary">
				<IconButton icon="plus" label="Add this choice" variant="secondary" />
			</Specimen>
			<Specimen label="primary">
				<IconButton icon="plus" label="New row" variant="primary" />
			</Specimen>
			<Specimen label="pressed">
				<IconButton icon="eye" label="Show hidden fields" pressed />
			</Specimen>
			<Specimen label="disabled">
				<IconButton icon="arrow-left" label="Move left" disabled />
			</Specimen>
		</Section>

		<Section name="Tooltip" from="ui/Tooltip.svelte">
			<Specimen label="IconButton's label, on hover or focus">
				<IconButton icon="search" label="Search" />
			</Specimen>
			<Specimen label="any trigger">
				<Tooltip text="Undo: Kg changed">
					{#snippet children(props)}
						<button
							{...props}
							type="button"
							class="inline-flex h-control items-center rounded-box px-3 {secondary}"
							>Hover me</button
						>
					{/snippet}
				</Tooltip>
			</Specimen>
			<Specimen label="with its shortcut, spelled by ui/keys.ts">
				<Tooltip text="Jump to a table" shortcut={keys('mod', 'p')}>
					{#snippet children(props)}
						<button
							{...props}
							type="button"
							class="inline-flex h-control items-center rounded-box px-3 {secondary}">Tables</button
						>
					{/snippet}
				</Tooltip>
			</Specimen>
			<Specimen label="a shortcut alone">
				<Tooltip shortcut={keys('alt', '1')}>
					{#snippet children(props)}
						<button
							{...props}
							type="button"
							class="inline-flex h-control items-center rounded-box px-3 {secondary}">Grid</button
						>
					{/snippet}
				</Tooltip>
			</Specimen>
		</Section>

		<Section name="Icon" from="ui/Icon.svelte">
			<div class="grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
				{#each ICONS as name (name)}
					<span class="flex flex-col items-center gap-2 rounded-box bg-tint p-3">
						<Icon {name} />
						<span class="font-mono text-xs text-ink-3">{name}</span>
					</span>
				{/each}
			</div>
		</Section>

		<Section name="Field icons" from="ui/field-icons.ts">
			<div class="grid w-full grid-cols-2 gap-2 sm:grid-cols-6">
				{#each FIELD_ICON_TYPES as type (type)}
					<span class="flex items-center gap-2 rounded-box bg-tint px-3 py-2">
						<Icon name={fieldIcon(type)} class="size-4 text-ink-2" />
						<span class="font-mono text-xs">{type}</span>
					</span>
				{/each}
			</div>
		</Section>

		<Section name="Fields" from="ui/styles.ts, ui/Field.svelte">
			<div class="grid w-full gap-6 sm:grid-cols-3">
				<Specimen label="input, empty" wide>
					<input class={input} placeholder="Exercise" aria-label="Empty input" />
				</Specimen>
				<Specimen label="input, filled" wide>
					<input class={input} bind:value={text} aria-label="Filled input" />
				</Specimen>
				<Specimen label="input, disabled" wide>
					<input class={input} value="Squat" disabled aria-label="Disabled input" />
				</Specimen>
				<Specimen label="Field with a hint" wide>
					<Field label="Name" hint="Every value carries over.">
						<input class={input} value="Kg" />
					</Field>
				</Specimen>
				<Specimen label="error" wide>
					<div class="flex w-full flex-col gap-2">
						<input class={input} value="&quot;Kg * 2" aria-label="Formula" />
						<p class="rounded-box bg-tint p-2" role="alert">
							SQLite refused the formula: unrecognized token
						</p>
					</div>
				</Specimen>
				<Specimen label="checkbox" wide>
					<label class="flex min-h-control items-center gap-2">
						<input type="checkbox" class={checkbox} checked />Done
					</label>
				</Specimen>
				<Specimen label="textarea (formula)" wide>
					<textarea class="{textarea} h-24" aria-label="Formula text">"Kg" * "Reps"</textarea>
				</Specimen>
			</div>
		</Section>

		<Section name="Textarea" from="ui/Textarea.svelte">
			<div class="grid w-full gap-6 sm:grid-cols-2">
				<Specimen label="grows to maxRows=8, then scrolls" wide>
					<Textarea bind:value={note} aria-label="Notes" />
				</Specimen>
				<Specimen label="bare, in a composer (fieldFocusWithin)" wide>
					<form
						class="flex w-full items-end gap-2 rounded-box p-2 {fieldFill} {fieldFocusWithin}"
						onsubmit={(event) => event.preventDefault()}
					>
						<Textarea
							bare
							rows={2}
							bind:value={composer}
							class="flex-1"
							placeholder="Ask about your tables"
							aria-label="Composer"
						/>
						<Button variant="primary" type="submit" disabled={composer.trim() === ''}>Send</Button>
					</form>
				</Specimen>
			</div>
		</Section>

		<Section name="AffixInput" from="ui/AffixInput.svelte">
			<div class="grid w-full gap-6 sm:grid-cols-3">
				<Specimen label="prefix" wide>
					<AffixInput bind:value={amount} prefix="€" aria-label="Amount" inputmode="decimal" />
				</Specimen>
				<Specimen label="suffix" wide>
					<AffixInput value="102.5" suffix="kg" aria-label="Weight" />
				</Specimen>
				<Specimen label="empty, with a placeholder" wide>
					<AffixInput suffix="%" placeholder="Share" aria-label="Share" />
				</Specimen>
			</div>
		</Section>

		<Section name="Select" from="ui/Select.svelte">
			<div class="grid w-full gap-6 sm:grid-cols-3">
				<Specimen label="grouped, as the field types" wide>
					<Select aria-label="Type" options={typeOptions()} bind:value={fieldType} />
				</Specimen>
				<Specimen label="a few options, with icons" wide>
					<Select
						aria-label="Order"
						options={[
							{ value: 'asc', label: 'Ascending', icon: 'arrow-up' },
							{ value: 'desc', label: 'Descending', icon: 'arrow-down' }
						]}
						bind:value={order}
					/>
				</Specimen>
				<Specimen label="past seven options: type to search" wide>
					<Select aria-label="Field" options={MANY} bind:value={field} placeholder="Pick a field" />
				</Specimen>
				<Specimen label="choices, with their colour" wide>
					<Select aria-label="Session" options={SESSIONS} bind:value={session} />
				</Specimen>
				<Specimen label="empty, with a placeholder" wide>
					<Select
						aria-label="Empty select"
						options={[{ value: '', label: '' }, ...SESSIONS]}
						bind:value={none}
						placeholder="Session"
					/>
				</Specimen>
				<Specimen label="disabled" wide>
					<Select aria-label="Disabled select" options={SESSIONS} value="Push" disabled />
				</Specimen>
			</div>
		</Section>

		<Section name="Rating" from="ui/Rating.svelte">
			<Specimen label="input, 1 to 5">
				<Rating label="Mood" value={stars} onchange={(next) => (stars = next)} />
			</Specimen>
			<Specimen label="input, 0 to 10 by halves">
				<Rating
					label="Score"
					min={0}
					max={10}
					step={0.5}
					value={halves}
					onchange={(next) => (halves = next)}
				/>
			</Specimen>
			<Specimen label="input, empty">
				<Rating label="Empty rating" value={null} onchange={() => undefined} />
			</Specimen>
			<Specimen label="shown, in a cell">
				<Rating value={3.5} max={5} step={0.5} size="sm" />
			</Specimen>
		</Section>

		<Section name="ChipPicker" from="ui/ChipPicker.svelte">
			<Specimen label="several picks, a new one on the way">
				<ChipPicker
					label="Tags"
					options={[
						{ name: 'Strength', color: 'violet' },
						{ name: 'Outdoors', color: 'teal' },
						{ name: 'Morning', color: 'amber' }
					]}
					value={tags}
					onchange={(next) => (tags = next)}
					oncreate={() => undefined}
				/>
			</Specimen>
			<Specimen label="nothing picked, no new ones">
				<ChipPicker
					label="Sessions"
					options={[
						{ name: 'Push', color: 'orange' },
						{ name: 'Pull', color: 'blue' }
					]}
					value={[]}
					onchange={() => undefined}
				/>
			</Specimen>
		</Section>

		<Section name="Menu" from="ui/Menu.svelte, MenuItem, MenuSub, MenuSeparator">
			<Specimen label="dropdown, from its trigger">
				<Menu label="Sets">
					{#snippet trigger(props)}
						<IconButton {...props} icon="more" label="More" tooltip={false} />
					{/snippet}
					<MenuItem icon="eye" onSelect={() => (menuChoice = 'View settings')}
						>View settings</MenuItem
					>
					<MenuItem icon="plus" shortcut="Alt N" onSelect={() => (menuChoice = 'New view')}
						>New view</MenuItem
					>
					<MenuSub label="Move to" icon="arrow-right">
						<MenuItem checked onSelect={() => (menuChoice = 'Moved to Gym')}>Gym</MenuItem>
						<MenuItem onSelect={() => (menuChoice = 'Moved to Money')}>Money</MenuItem>
					</MenuSub>
					<MenuItem icon="arrow-down" disabled>Export (disabled)</MenuItem>
					<MenuSeparator />
					<MenuItem icon="x" onSelect={() => (menuChoice = 'Delete table')}>Delete table</MenuItem>
				</Menu>
			</Specimen>
			<Specimen label="last picked">
				<span class="flex h-control items-center text-ink-2" data-testid="menu-choice"
					>{menuChoice}</span
				>
			</Specimen>
		</Section>

		<Section name="ContextMenu" from="ui/ContextMenu.svelte">
			<Specimen label="right-click or long-press the area" wide>
				<ContextMenu label="Row">
					{#snippet target(props)}
						<div
							{...props}
							class="flex h-24 w-full items-center justify-center rounded-panel bg-tint text-ink-2 select-none"
						>
							Right-click here
						</div>
					{/snippet}
					<MenuItem icon="arrow-up" onSelect={() => (menuChoice = 'Insert above')}
						>Insert above</MenuItem
					>
					<MenuItem icon="arrow-down" onSelect={() => (menuChoice = 'Insert below')}
						>Insert below</MenuItem
					>
					<MenuSeparator />
					<MenuItem icon="x" onSelect={() => (menuChoice = 'Delete row')}>Delete row</MenuItem>
				</ContextMenu>
			</Specimen>
		</Section>

		<Section name="Dialog" from="ui/Dialog.svelte">
			<Specimen label="centred from sm, a sheet on phones; dirty asks before closing">
				<Button onclick={() => (dialogOpen = true)}>Open a dialog</Button>
				<Dialog
					bind:open={dialogOpen}
					title="Rename base"
					dirty={dirtyName !== ''}
					onsubmit={() => (dialogOpen = false)}
				>
					<input class={input} bind:value={dirtyName} placeholder="Gym" aria-label="Base name" />
					{#snippet footer()}
						<div class="flex-1"></div>
						<Button variant="primary" onclick={() => (dialogOpen = false)}>Rename</Button>
					{/snippet}
				</Dialog>
			</Specimen>
		</Section>

		<Section name="Segmented" from="ui/Segmented.svelte">
			<Specimen label="tone=inset">
				<Segmented
					label="Views example"
					items={['grid', 'entry', 'list', 'chart'].map((id) => ({
						id,
						label: id[0].toUpperCase() + id.slice(1),
						active: segment === id,
						onclick: () => (segment = id)
					}))}
				/>
			</Specimen>
			<Specimen label="tone=float">
				<Segmented
					label="Tables example"
					tone="float"
					items={['All', 'Sets', 'Exercises'].map((label) => ({
						id: label,
						label,
						active: label === 'Sets',
						onclick: () => {}
					}))}
				/>
			</Specimen>
		</Section>

		<Section name="Stepper" from="ui/Stepper.svelte">
			{#each ['xs', 'sm', 'md', 'lg'] as const as size (size)}
				<Specimen label="size={size}">
					<div class="w-48">
						<Stepper
							label="Kg"
							{size}
							text={kg}
							oninput={(next) => (kg = next)}
							onstep={(direction) => (kg = String((Number(kg) || 0) + direction * 2.5))}
						/>
					</div>
				</Specimen>
			{/each}
		</Section>

		<Section name="PasswordInput" from="ui/PasswordInput.svelte">
			<Specimen label="reveal toggle">
				<div class="w-64"><PasswordInput bind:value={password} aria-label="Password" /></div>
			</Specimen>
		</Section>

		<Section name="CodeInput" from="ui/CodeInput.svelte">
			<Specimen label="six digits">
				<div class="w-80"><CodeInput bind:value={code} /></div>
			</Specimen>
			<Specimen label="disabled">
				<div class="w-80"><CodeInput value="123456" disabled /></div>
			</Specimen>
		</Section>

		<Section name="Chip" from="ui/Chip.svelte">
			{#each DATA_COLORS as color (color)}
				<Specimen label={color}>
					<Chip name={color[0].toUpperCase() + color.slice(1)} {color} />
				</Specimen>
			{/each}
			<Specimen label="long name">
				<div class="w-32"><Chip name="Accessory work for the posterior chain" color="teal" /></div>
			</Specimen>
		</Section>

		<Section name="Spark" from="ui/Spark.svelte">
			<Specimen label="line: a 7-day rolling average">
				<Spark values={[88.4, 88.25, 88.13, 88.1]} label="Trend" />
			</Specimen>
			<Specimen label="bar: weekly totals">
				<Spark
					kind="bar"
					values={[1679, 28082, 24875, 14602, 12053, 9930, 2822, 4078, 2484, 1420]}
					label="Trend"
				/>
			</Specimen>
			<Specimen label="bar: a month at zero">
				<Spark kind="bar" values={[3, 0, 2]} label="Trend" />
			</Specimen>
			<Specimen label="one value">
				<Spark values={[81.5]} label="Trend" />
			</Specimen>
		</Section>

		<Section name="Tally" from="ui/Tally.svelte">
			<Specimen label="3 of 10: a tick per row">
				<Tally done={3} total={10} />
			</Specimen>
			<Specimen label="41 of 120: two parts">
				<Tally done={41} total={120} />
			</Specimen>
			<Specimen label="none ticked">
				<Tally done={0} total={6} />
			</Specimen>
		</Section>

		<Section name="Empty" from="ui/Empty.svelte">
			<Specimen label="one line, one action" wide>
				<div class="w-full rounded-panel bg-raised shadow-raised">
					<Empty text="This table is empty.">
						<Button variant="primary">New row</Button>
					</Empty>
				</div>
			</Specimen>
		</Section>

		<Section name="Markdown" from="ui/Markdown.svelte">
			<Specimen label="the assistant's replies" wide>
				<div class="w-full max-w-prose"><Markdown text={MARKDOWN} /></div>
			</Specimen>
		</Section>

		<Section name="Logo" from="ui/Logo.svelte">
			<Specimen label="class=h-5"><Logo class="h-5" /></Specimen>
			<Specimen label="wordmark class=h-6"><Logo wordmark class="h-6" /></Specimen>
		</Section>

		{#if fixture === null}
			<p class="py-8 text-ink-2" role="status">Loading the sample table…</p>
		{:else}
			{@const table = fixture.table}
			<Section name="CellValue" from="views/CellValue.svelte">
				{#each typed.fields as item (item.id)}
					<Specimen label={item.type}>
						<span class="flex h-row min-w-24 items-center rounded-box bg-raised px-3 shadow-raised">
							<CellValue
								field={item}
								value={item.type === 'formula'
									? (typed.computed?.[item.id] ?? null)
									: typed.row?.data[item.id]}
							/>
						</span>
					</Specimen>
				{/each}
				<Specimen label="empty">
					<span class="flex h-row w-24 items-center rounded-box bg-raised px-3 shadow-raised">
						<CellValue field={fields[0]} value={null} />
					</span>
				</Specimen>
			</Section>

			<Section name="FieldInput" from="views/FieldInput.svelte">
				<div class="grid w-full gap-6 sm:grid-cols-4">
					{#each typed.fields as item (item.id)}
						<Specimen label={item.type} wide>
							<div class="flex w-full flex-col gap-1">
								<label for="type-{item.id}" class="text-sm font-medium text-ink-2"
									>{item.name}</label
								>
								<FieldInput
									id="type-{item.id}"
									field={item}
									value={typed.row?.data[item.id] ?? null}
									computed={typed.computed?.[item.id] ?? null}
								/>
							</div>
						</Specimen>
					{/each}
				</div>
			</Section>

			{#each [{ name: 'Grid', id: fixture.views.grid }, { name: 'Entry', id: fixture.views.entry }, { name: 'List', id: fixture.views.list }, { name: 'Chart', id: fixture.views.chart }] as shown (shown.name)}
				{@const current = view(shown.id)}
				<Section name={shown.name} from="views/{shown.name}.svelte">
					<Specimen label="on the sample table" wide>
						<div class="h-96 w-full overflow-auto rounded-panel bg-raised shadow-raised">
							{#if current !== undefined}
								{#if shown.name === 'Grid'}
									<Grid tableId={table} view={current} />
								{:else if shown.name === 'Entry'}
									<Entry tableId={table} view={current} />
								{:else if shown.name === 'List'}
									<List tableId={table} view={current} />
								{:else}
									<Chart tableId={table} view={current} />
								{/if}
							{/if}
						</div>
					</Specimen>
					{#if shown.name === 'Grid'}
						{@const every = view(fixture.types.grid)}
						<Specimen label="every type" wide>
							<div class="h-48 w-full overflow-auto rounded-panel bg-raised shadow-raised">
								{#if every !== undefined}
									<Grid tableId={fixture.types.table} view={every} />
								{/if}
							</div>
						</Specimen>
					{/if}
				</Section>
			{/each}

			<Section name="RowSheet" from="views/RowSheet.svelte">
				<Specimen label="a row">
					<Button onclick={() => (rowOpen = true)}>Open a row</Button>
				</Specimen>
				<Specimen label="a new row">
					<Button onclick={() => (newRowOpen = true)}>New row</Button>
				</Specimen>
				<Specimen label="every type">
					<Button onclick={() => (typesOpen = true)}>Open every type</Button>
				</Specimen>
				<RowSheet bind:open={rowOpen} tableId={table} rowId={fixture.rows[0]} />
				<RowSheet bind:open={typesOpen} tableId={fixture.types.table} rowId={fixture.types.row} />
				<RowSheet bind:open={newRowOpen} tableId={table} />
			</Section>

			<Section name="FieldSheet" from="views/FieldSheet.svelte">
				<Specimen label="a choice field">
					<Button onclick={() => (fieldOpen = true)}>Open Session</Button>
				</Specimen>
				<FieldSheet
					bind:open={fieldOpen}
					tableId={table}
					fieldId={fields.find((item) => item.type === 'choice')?.id ?? null}
				/>
			</Section>

			<Section name="ViewSheet" from="views/ViewSheet.svelte">
				<Specimen label="the chart's settings">
					<Button onclick={() => (viewOpen = true)}>Open Chart settings</Button>
				</Specimen>
				<ViewSheet bind:open={viewOpen} tableId={table} viewId={fixture.views.chart} />
			</Section>
		{/if}

		<Section name="Toast" from="views/Toast.svelte">
			<Specimen label="after a change, with Undo when there is one" wide>
				<div class="relative h-40 w-full rounded-panel bg-tint">
					<div class="flex gap-2 p-3">
						<Button onclick={() => showToast('Row added')}>Show a toast</Button>
					</div>
					<Toast />
				</div>
			</Specimen>
		</Section>

		<Section name="ChangeCard" from="views/ChangeCard.svelte">
			<div class="flex w-full max-w-ask flex-col gap-2">
				{#each changes as action (action.id)}
					<Specimen label="{action.id}, status={action.status}" wide>
						<div class="w-full">
							<ChangeCard {action} onopen={() => {}} />
						</div>
					</Specimen>
				{/each}
			</div>
		</Section>
	</main>
</div>
