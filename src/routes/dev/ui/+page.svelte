<script lang="ts">
	import { onMount } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import type { Item } from '#lib/core/thread.ts';
	import { seedFixture, type Fixture } from '#lib/dev/fixtures.ts';
	import Section from '#lib/dev/Section.svelte';
	import Specimen from '#lib/dev/Specimen.svelte';
	import { forceTheme, type Theme } from '#lib/dev/theme.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import CodeInput from '#lib/ui/CodeInput.svelte';
	import { DATA_COLORS } from '#lib/ui/colors.ts';
	import ContextMenu from '#lib/ui/ContextMenu.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import { FIELD_ICON_TYPES, fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon, { ICONS } from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import Markdown from '#lib/ui/Markdown.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';
	import PasswordInput from '#lib/ui/PasswordInput.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import Select, { type Option } from '#lib/ui/Select.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import { checkbox, fieldFocusWithin, input, textarea } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import CellValue from '#lib/views/CellValue.svelte';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import FieldInput from '#lib/views/FieldInput.svelte';
	import FieldSheet from '#lib/views/FieldSheet.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';
	import RowSheet from '#lib/views/RowSheet.svelte';
	import ThreadTool from '#lib/views/ThreadTool.svelte';
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
				'Select',
				'Menu',
				'ContextMenu',
				'Dialog',
				'Segmented',
				'Stepper',
				'PasswordInput',
				'CodeInput',
				'Chip',
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
				'ThreadTool'
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

	const TOOLS: Extract<Item, { kind: 'tool' }>[] = [
		{
			kind: 'tool',
			key: 'running',
			name: 'insert_rows',
			label: 'Adding 3 rows to Sets',
			state: 'running',
			input: { table: 'Sets', rows: 3 },
			output: null,
			action: null
		},
		{
			kind: 'tool',
			key: 'done',
			name: 'read_rows',
			label: 'Read Sets',
			state: 'done',
			input: { table: 'Sets' },
			output: '{"rows": 6}',
			action: null
		},
		{
			kind: 'tool',
			key: 'error',
			name: 'add_field',
			label: 'Add a field to Sets',
			state: 'error',
			input: { name: 'Kg' },
			output: '{"error": "A field named Kg already exists."}',
			action: null
		}
	];

	const fields = $derived.by(() => {
		void app.version;
		return fixture === null ? [] : app.ws.fields(fixture.table);
	});

	const view = (id: string | undefined) => {
		void app.version;
		return id === undefined ? undefined : app.ws.view(id);
	};

	const firstRow = $derived.by(() => {
		void app.version;
		return fixture === null ? undefined : app.ws.live(fixture.rows[0]);
	});

	const computed = $derived.by(() => {
		void app.version;
		return fixture === null || firstRow === undefined
			? undefined
			: app.computed(fixture.table).get(firstRow.id);
	});

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
							class="inline-flex h-control items-center rounded-box bg-tint px-3">Hover me</button
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
						class="flex w-full items-end gap-2 rounded-box bg-tint p-2 {fieldFocusWithin}"
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

		<Section name="Select" from="ui/Select.svelte">
			<div class="grid w-full gap-6 sm:grid-cols-3">
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
						<MenuItem onSelect={() => (menuChoice = 'Moved to Gym')}>Gym</MenuItem>
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
			{#each ['sm', 'md', 'lg'] as const as size (size)}
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
				{#each fields as item (item.id)}
					<Specimen label={item.type}>
						<span class="flex h-row min-w-24 items-center rounded-box bg-raised px-3 shadow-raised">
							<CellValue
								field={item}
								value={item.type === 'formula'
									? (computed?.[item.id] ?? null)
									: firstRow?.data[item.id]}
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
					{#each fields as item (item.id)}
						<Specimen label={item.type} wide>
							<Field label={item.name}>
								<FieldInput
									field={item}
									value={firstRow?.data[item.id] ?? null}
									computed={computed?.[item.id] ?? null}
								/>
							</Field>
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
				</Section>
			{/each}

			<Section name="RowSheet" from="views/RowSheet.svelte">
				<Specimen label="a row">
					<Button onclick={() => (rowOpen = true)}>Open a row</Button>
				</Specimen>
				<Specimen label="a new row">
					<Button onclick={() => (newRowOpen = true)}>New row</Button>
				</Specimen>
				<RowSheet bind:open={rowOpen} tableId={table} rowId={fixture.rows[0]} />
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

		<Section name="ThreadTool" from="views/ThreadTool.svelte">
			<div class="flex w-full max-w-ask flex-col gap-2">
				{#each TOOLS as item (item.key)}
					<Specimen label="state={item.state}" wide>
						<div class="w-full">
							<ThreadTool {item} busy={item.state === 'running'} onopen={() => {}} />
						</div>
					</Specimen>
				{/each}
			</div>
		</Section>
	</main>
</div>
