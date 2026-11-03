<script lang="ts">
	import { flushSync, onDestroy, onMount, untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { fresh } from '#lib/client/assistant.svelte.ts';
	import { formatDate, formatNumber } from '#lib/client/format.ts';
	import { gridJump } from '#lib/client/grid.svelte.ts';
	import { clearSelection, selection } from '#lib/client/selection.svelte.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import {
		deleteRecords,
		insertRows,
		reorder,
		updateRecord,
		updateRow
	} from '#lib/core/actions.ts';
	import type {
		Change,
		FieldDef,
		FieldType,
		GridConfig,
		Rec,
		Value,
		ViewDef
	} from '#lib/core/model.ts';
	import { CREATED } from '#lib/core/model.ts';
	import { retypeField } from '#lib/core/retype.ts';
	import { hasTime, nowIso, todayIso } from '#lib/core/values.ts';
	import Button from '#lib/ui/Button.svelte';
	import { nextChoice } from '#lib/ui/colors.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { input as inputStyle } from '#lib/ui/styles.ts';

	import AddField from './AddField.svelte';
	import CellValue from './CellValue.svelte';
	import FieldSheet from './FieldSheet.svelte';
	import type { Box } from './fill.ts';
	import { fillChanges, fillTarget } from './fill.ts';
	import FormulaEditor from './FormulaEditor.svelte';
	import {
		cellReader,
		cellText,
		cellValue,
		clearChanges,
		copyText,
		fillSelection,
		fitWidth,
		gridRows,
		linkOptions,
		parseTsv,
		pasteChanges,
		sampleRows,
		timedColumn,
		toTsv
	} from './grid.ts';
	import type { ColumnAction } from './GridColumnMenu.svelte';
	import GridColumnMenu from './GridColumnMenu.svelte';
	import GridPicker from './GridPicker.svelte';
	import GridRowMenu from './GridRowMenu.svelte';
	import RowSheet from './RowSheet.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	// Matches the row-number column's `w-11`.
	const NUMBER_WIDTH = 44;
	const ADD_WIDTH = 44;
	// Small tables stay whole in the DOM, so the browser's own find still reaches every row.
	const VIRTUAL_ABOVE = 100;
	const OVERSCAN = 16;
	// The window moves in steps so a scroll rarely touches the DOM twice for the same rows.
	const WINDOW_STEP = 8;
	const MIN_WIDTH = 48;
	const MAX_WIDTH = 800;
	const DRAG_START = 5;
	// On a phone the first column gives way to the columns scrolling beside it.
	const STICKY_SHARE = 0.4;
	const PHONE = 640;
	const BLANK = '';

	type Pos = { row: string; field: string; r: number };
	type Editing = { row: string; field: string; initial: string; typed: boolean; touch: boolean };

	let scroller = $state<HTMLElement>();
	let table = $state<HTMLTableElement>();
	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	let viewHeight = $state(0);
	let viewWidth = $state(0);
	let rowHeight = $state(34);

	let anchor = $state.raw<Pos | null>(null);
	let head = $state.raw<Pos | null>(null);
	let focused = $state(false);
	let editing = $state.raw<Editing | null>(null);
	let draft = $state('');
	let seed = $state('');
	let nativeDate = $state<'date' | 'datetime-local' | null>(null);

	let rowOpen = $state(false);
	let rowId = $state<string | null>(null);
	let fieldOpen = $state(false);
	let fieldId = $state<string | null>(null);
	let preset = $state<{ name: string; type: FieldType; at?: number } | null>(null);
	let menuOpen = $state(false);
	let menuField = $state<string | null>(null);
	let menuAnchor = $state<HTMLElement | null>(null);
	let liveFilter = $state<string | null>(null);
	let renaming = $state<string | null>(null);
	let renameDraft = $state('');
	let formulaEdit = $state.raw<{ field: string; anchor: HTMLElement; typed: string } | null>(null);
	let inserting = $state(false);
	let insertAt = $state.raw<{ anchor: HTMLElement; at: number } | null>(null);
	let rowMenuOpen = $state(false);
	let point = $state({ x: 0, y: 0 });
	let pointAnchor = $state<HTMLElement | null>(null);
	let filling = $state.raw<Box | null>(null);

	let fitted = $state.raw<Record<string, number>>({});
	let fontsReady = $state(0);
	let resizing = $state.raw<{ field: string; width: number } | null>(null);
	let columnDrag = $state.raw<{ field: string; at: number } | null>(null);
	let ignoreHeaderClick = false;
	let fitContext: CanvasRenderingContext2D | null = null;
	let catcher = $state<HTMLTextAreaElement>();
	let catcherRelease: ReturnType<typeof setTimeout> | undefined;

	const fields = $derived.by(() => {
		void app.version;
		const hidden = new Set(view.config.hidden ?? []);
		return app.ws.fields(tableId).filter((field) => !hidden.has(field.id));
	});

	const computed = $derived.by(() => {
		void app.version;
		return app.computed(tableId);
	});

	const config = $derived.by((): GridConfig => {
		const saved = view.config.filter;
		return liveFilter === null || menuField === null
			? view.config
			: {
					...view.config,
					filter:
						liveFilter === '' && saved?.field !== menuField
							? saved
							: { field: menuField, text: liveFilter }
				};
	});

	const rows = $derived.by(() => {
		void app.version;
		return gridRows(app.ws, tableId, config, computed);
	});

	const allRows = $derived.by(() => {
		void app.version;
		return app.ws.rows(tableId);
	});

	const rowIndex = $derived(new Map(rows.map((row, index) => [row.id, index])));
	const fieldIndex = $derived(new Map(fields.map((field, index) => [field.id, index])));

	const filterField = $derived.by(() => {
		const filter = config.filter;
		return filter && filter.text !== ''
			? fields.find((field) => field.id === filter.field)
			: undefined;
	});

	function widthOf(field: FieldDef, index: number): number {
		if (resizing?.field === field.id) return resizing.width;
		const width = view.config.widths?.[field.id] ?? fitted[field.id] ?? 160;
		return index === 0 && viewWidth > 0 && viewWidth < PHONE
			? Math.min(width, Math.round(viewWidth * STICKY_SHARE))
			: width;
	}

	const widths = $derived(fields.map((field, index) => widthOf(field, index)));

	const lefts = $derived.by(() => {
		const out = [NUMBER_WIDTH];
		for (const width of widths) out.push((out.at(-1) as number) + width);
		return out;
	});

	const stickyEnd = $derived(lefts[Math.min(1, fields.length)]);

	// The window. `start` and `end` are numbers so a scroll inside one step reaches nothing below them.
	const total = $derived(rows.length + 1);
	const start = $derived.by(() => {
		if (total <= VIRTUAL_ABOVE) return 0;
		const first = Math.min(Math.floor(scrollTop / rowHeight), total) - OVERSCAN;
		return Math.max(0, Math.floor(first / WINDOW_STEP) * WINDOW_STEP);
	});
	const end = $derived.by(() => {
		if (total <= VIRTUAL_ABOVE) return total;
		const last = Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN;
		return Math.min(total, Math.ceil(last / WINDOW_STEP) * WINDOW_STEP);
	});
	const visible = $derived(rows.slice(start, end));
	const showBlank = $derived(end === total);

	function rowOf(pos: Pos): number {
		return pos.row === BLANK
			? rows.length
			: (rowIndex.get(pos.row) ?? Math.min(pos.r, rows.length));
	}

	function colOf(pos: Pos): number {
		return fieldIndex.get(pos.field) ?? 0;
	}

	const headRow = $derived(head === null ? -1 : rowOf(head));
	const headCol = $derived(head === null ? -1 : colOf(head));
	const anchorRow = $derived(anchor === null ? -1 : rowOf(anchor));
	const anchorCol = $derived(anchor === null ? -1 : colOf(anchor));
	const top = $derived(Math.min(anchorRow, headRow));
	const bottom = $derived(Math.max(anchorRow, headRow));
	const left = $derived(Math.min(anchorCol, headCol));
	const right = $derived(Math.max(anchorCol, headCol));
	const isRange = $derived(top !== bottom || left !== right);

	const cellId = (r: number, c: number): string => `grid-cell-${r}-${c}`;

	onMount(() => {
		void document.fonts.ready.then(() => (fontsReady += 1));
	});

	// A fit follows the data only until someone starts working in the grid: after that a column never moves on its own.
	$effect.pre(() => {
		void fontsReady;
		const current = allRows;
		const list = fields;
		untrack(() => {
			const measure = fitMeasure();
			if (measure === null) return;
			const sample = sampleRows(current);
			let next = fitted;
			for (const field of list) {
				if (head === null || next[field.id] === undefined) {
					const width = fitOf(field, sample, measure);
					if (next[field.id] !== width) next = { ...next, [field.id]: width };
				}
			}
			fitted = next;
		});
	});

	$effect(() => {
		void viewWidth;
		const styles = getComputedStyle(document.documentElement);
		rowHeight = parseFloat(styles.getPropertyValue('--row')) || rowHeight;
	});

	$effect(() => {
		const jump = gridJump.blankRow;
		if (jump !== 0) {
			untrack(() => {
				gridJump.blankRow = 0;
				const first = fields.findIndex((field) => field.type !== 'formula');
				select(rows.length, Math.max(0, first));
				table?.focus({ preventScroll: true });
			});
		}
	});

	$effect(() => {
		if (gridJump.fitAll !== 0) {
			untrack(() => {
				gridJump.fitAll = 0;
				fitAll();
			});
		}
	});

	$effect(() => {
		if (!menuOpen) untrack(settleFilter);
	});

	$effect(() => {
		const ids = head === null ? [] : rows.slice(Math.max(0, top), bottom + 1).map((row) => row.id);
		untrack(() => {
			selection.table = tableId;
			selection.rows = ids;
			selection.fields =
				head === null ? [] : fields.slice(left, right + 1).map((field) => field.id);
		});
	});

	onDestroy(clearSelection);

	$effect(() => {
		const id = [...fresh].find((candidate) => rowIndex.has(candidate));
		if (id !== undefined) untrack(() => reveal(rowIndex.get(id) as number, 0));
	});

	function onscroll(): void {
		if (scroller === undefined) return;
		scrollTop = scroller.scrollTop;
		scrollLeft = scroller.scrollLeft;
		const target = editing;
		if (target === null) return;
		const r = target.row === BLANK ? rows.length : rowIndex.get(target.row);
		// A row scrolled far enough away leaves the DOM, and its editor with it.
		if (r === undefined || r < start || r >= end) {
			const type = app.ws.field(target.field)?.type;
			if (type === 'choice' || type === 'link') editing = null;
			else commitDraft({ leaving: true });
		}
	}

	function fitMeasure(): {
		body: (text: string) => number;
		header: (text: string) => number;
	} | null {
		fitContext ??= document.createElement('canvas').getContext('2d');
		const context = fitContext;
		if (context === null) return null;
		const styles = getComputedStyle(document.body);
		const root = getComputedStyle(document.documentElement);
		const family = styles.fontFamily;
		const bodyFont = `${styles.fontSize} ${family}`;
		const headerFont = `500 ${root.getPropertyValue('--size-sm')} ${family}`;
		return {
			body: (text) => {
				context.font = bodyFont;
				return context.measureText(text).width;
			},
			header: (text) => {
				context.font = headerFont;
				return context.measureText(text).width;
			}
		};
	}

	function fitOf(
		field: FieldDef,
		sample: Rec[],
		measure: { body: (text: string) => number; header: (text: string) => number }
	): number {
		return fitWidth(
			field,
			sample.map((row) => cellText(app.ws, field, cellValue(row, field, computed))),
			measure
		);
	}

	function setConfig(
		patch: Partial<GridConfig>,
		label: string,
		apply: (changes: Change[], label: string) => unknown = applyWithUndo
	): void {
		const next = JSON.parse(JSON.stringify({ ...view.config, ...patch })) as Value;
		apply(updateRecord(app.ws, view.id, { config: next }), label);
	}

	function posAt(r: number, c: number): Pos {
		return {
			row: rows[r]?.id ?? BLANK,
			field: fields[c]?.id ?? '',
			r
		};
	}

	function reveal(r: number, c: number): void {
		if (scroller === undefined) return;
		const y = rowHeight + r * rowHeight;
		const height = scroller.clientHeight;
		if (y < scroller.scrollTop + rowHeight) {
			scroller.scrollTop = y - rowHeight;
		} else if (y + rowHeight > scroller.scrollTop + height) {
			scroller.scrollTop = y + rowHeight - height;
		}
		if (c > 0) {
			const from = lefts[c];
			const to = lefts[c + 1];
			if (from < scroller.scrollLeft + stickyEnd) {
				scroller.scrollLeft = from - stickyEnd;
			} else if (to > scroller.scrollLeft + scroller.clientWidth) {
				scroller.scrollLeft = to - scroller.clientWidth;
			}
		}
		// The scroll event comes a frame later, and an editor may need this row now.
		scrollTop = scroller.scrollTop;
		scrollLeft = scroller.scrollLeft;
	}

	function select(r: number, c: number, extend = false): void {
		if (fields.length === 0) return;
		const limit = extend && anchor?.row !== BLANK ? rows.length - 1 : rows.length;
		const row = Math.max(0, Math.min(limit, r));
		const col = Math.max(0, Math.min(fields.length - 1, c));
		head = posAt(row, col);
		if (!extend || anchor === null) anchor = head;
		reveal(row, col);
	}

	function selectPos(row: string, field: string): void {
		const r = row === BLANK ? rows.length : (rowIndex.get(row) ?? rows.length);
		const c = fieldIndex.get(field) ?? 0;
		select(r, c);
	}

	function todayDates(): Record<string, Value> {
		return Object.fromEntries(
			app.ws
				.fields(tableId)
				.filter((field) => field.type === 'date')
				.map((field) => [field.id, todayIso()])
		);
	}

	function newChoiceChanges(field: FieldDef, value: Value): Change[] {
		if (
			field.type !== 'choice' ||
			typeof value !== 'string' ||
			field.choices.some((choice) => choice.name === value)
		) {
			return [];
		}
		const choices = [...field.choices, nextChoice(field.choices, value)];
		return updateRecord(app.ws, field.id, {
			choices: choices.map((choice) => ({ name: choice.name, color: choice.color }))
		});
	}

	/** A typed cell applies quietly where Ctrl+Z is at hand; a touch screen has only the toast's Undo. */
	function applyCell(changes: Change[], label: string): void {
		if (matchMedia('(pointer: coarse)').matches) applyWithUndo(changes, label);
		else app.apply(changes, label);
	}

	/** The id of the row this made, when it wrote into the blank row. */
	function writeCell(rowKey: string, field: FieldDef, value: Value): string | null {
		const extra = newChoiceChanges(field, value);
		if (rowKey === BLANK) {
			if (value === null) return null;
			const made = insertRows(app.ws, tableId, [{ ...todayDates(), [field.id]: value }]);
			applyCell([...extra, ...made.changes], 'Row added');
			return made.ids[0];
		}
		const row = app.ws.live(rowKey);
		if (row !== undefined && JSON.stringify(row.data[field.id] ?? null) !== JSON.stringify(value)) {
			applyCell(
				[...extra, ...updateRow(app.ws, rowKey, { [field.id]: value })],
				`${field.name} changed`
			);
		}
		return null;
	}

	function settle(
		target: Editing,
		value: Value | undefined,
		down: number,
		across: number,
		leaving: boolean
	): void {
		const field = app.ws.field(target.field);
		const r = target.row === BLANK ? rows.length : (rowIndex.get(target.row) ?? rows.length);
		const c = fieldIndex.get(target.field) ?? 0;
		let nextRow = r + down;
		let nextCol = c + across;
		if (nextCol >= fields.length) {
			nextCol = 0;
			nextRow += 1;
		} else if (nextCol < 0) {
			nextCol = fields.length - 1;
			nextRow -= 1;
		}
		const nextKey = nextRow === r || nextRow < 0 ? target.row : (rows[nextRow]?.id ?? BLANK);

		editing = null;
		const created =
			field === undefined || value === undefined ? null : writeCell(target.row, field, value);
		flushSync();

		if (down !== 0 || across !== 0) {
			selectPos(
				nextKey === BLANK && nextRow === r && created !== null ? created : nextKey,
				fields[nextCol]?.id ?? ''
			);
		}
		if (leaving) return;
		if (!target.touch) {
			table?.focus({ preventScroll: true });
		} else if (down !== 0 && nextKey !== BLANK && nextKey !== target.row) {
			// Opened before the old editor's blur lands, so the keyboard stays up in this field's mode.
			beginEdit(undefined, true);
		}
	}

	function commitDraft({
		down = 0,
		across = 0,
		leaving = false
	}: { down?: number; across?: number; leaving?: boolean } = {}): void {
		const target = editing;
		if (target === null) return;
		const field = app.ws.field(target.field);
		if (field === undefined) {
			editing = null;
			return;
		}
		if (draft === target.initial && (target.row !== BLANK || leaving)) {
			settle(target, undefined, down, across, leaving);
			return;
		}
		const value = cellReader(app.ws)(field, draft);
		if (value === undefined) {
			showToast(`"${draft}" isn't a ${field.type === 'number' ? 'number' : 'date'}.`);
			if (leaving) editing = null;
			return;
		}
		settle(target, value, down, across, leaving);
	}

	function cancelEdit(): void {
		editing = null;
		table?.focus({ preventScroll: true });
	}

	function initialDraft(field: FieldDef, row: Rec | undefined, native: boolean): string {
		const timed = native && timedColumn(app.ws, field);
		const fresh = timed ? nowIso() : todayIso();
		const stored = row === undefined && field.type === 'date' ? fresh : row?.data[field.id];
		const value =
			timed && typeof stored === 'string' && !hasTime(stored) ? `${stored}T00:00` : stored;
		if (field.type === 'number' && typeof value === 'number') {
			return formatNumber(value, { edit: true });
		}
		if (field.type === 'date' && typeof value === 'string') {
			return native ? value : formatDate(value);
		}
		return typeof value === 'string' ? value : '';
	}

	function toggleCheck(rowKey: string, field: FieldDef): void {
		const row = rowKey === BLANK ? undefined : app.ws.live(rowKey);
		const created = writeCell(rowKey, field, row?.data[field.id] !== true);
		if (created !== null) {
			flushSync();
			selectPos(created, field.id);
		}
	}

	function beginEdit(typed?: string, touch = false): void {
		if (head === null) return;
		const field = fields[headCol];
		if (field === undefined) return;
		const row = rows[headRow] as Rec | undefined;
		const key = row?.id ?? BLANK;
		if (field.type === 'formula') {
			const cell = document.getElementById(cellId(headRow, headCol));
			if (cell !== null) formulaEdit = { field: field.id, anchor: cell, typed: typed ?? '' };
			return;
		}
		if (field.type === 'check') {
			toggleCheck(key, field);
			return;
		}
		const native = touch && field.type === 'date';
		const initial = initialDraft(field, row, native);
		flushSync(() => {
			anchor = head;
			nativeDate = native ? (initial.includes('T') ? 'datetime-local' : 'date') : null;
			seed = typed ?? '';
			draft = typed ?? initial;
			editing = {
				row: key,
				field: field.id,
				initial,
				typed: typed !== undefined,
				touch
			};
		});
	}

	function rangeRows(): Rec[] {
		return rows.slice(Math.max(0, top), Math.min(rows.length, bottom + 1));
	}

	function rangeFields(): FieldDef[] {
		return fields.slice(Math.max(0, left), right + 1);
	}

	function clearRange(): number | null {
		const changes = clearChanges(app.ws, rangeFields(), rangeRows());
		const count = changes.length;
		return (
			applyWithUndo(changes, count === 1 ? 'Cell cleared' : `${count} rows cleared`)?.id ?? null
		);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.target !== table || head === null) return;
		const command = event.metaKey || event.ctrlKey;
		const extend = event.shiftKey;
		const lastRow = Math.max(0, rows.length - 1);
		const lastCol = fields.length - 1;
		const page = Math.max(1, Math.floor((viewHeight - rowHeight) / rowHeight));

		const moves: Record<string, () => [number, number]> = {
			ArrowUp: () => [command ? 0 : headRow - 1, headCol],
			ArrowDown: () => [command ? lastRow : headRow + 1, headCol],
			ArrowLeft: () => [headRow, command ? 0 : headCol - 1],
			ArrowRight: () => [headRow, command ? lastCol : headCol + 1],
			Home: () => [command ? 0 : headRow, 0],
			End: () => [command ? lastRow : headRow, lastCol],
			PageUp: () => [headRow - page, headCol],
			PageDown: () => [headRow + page, headCol]
		};

		const move = moves[event.key];
		if (move !== undefined) {
			event.preventDefault();
			const [r, c] = move();
			select(r, c, extend);
			return;
		}

		if (event.key === 'Tab') {
			const step = event.shiftKey ? -1 : 1;
			let r = headRow;
			let c = headCol + step;
			if (c > lastCol) {
				c = 0;
				r += 1;
			} else if (c < 0) {
				c = lastCol;
				r -= 1;
			}
			// Off either end of the grid, Tab leaves it as anywhere else on the page.
			if (r < 0 || r > rows.length) return;
			event.preventDefault();
			select(r, c);
		} else if (event.key === 'Enter' || event.key === 'F2') {
			event.preventDefault();
			beginEdit();
		} else if (event.key === 'Escape') {
			if (isRange) {
				event.preventDefault();
				anchor = head;
			}
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			clearRange();
		} else if (
			command &&
			!event.altKey &&
			!event.shiftKey &&
			['d', 'r'].includes(event.key.toLowerCase())
		) {
			event.preventDefault();
			fillFromEdge(event.key.toLowerCase() === 'd');
		} else if (command && !event.altKey && ['c', 'x'].includes(event.key.toLowerCase())) {
			if (!event.shiftKey) armCatcher(rangeTsv());
		} else if (command && !event.altKey && event.key.toLowerCase() === 'v') {
			armCatcher('');
		} else if (command && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			anchor = posAt(0, 0);
			head = posAt(lastRow, lastCol);
		} else if (event.key === ' ' && fields[headCol]?.type === 'check') {
			event.preventDefault();
			beginEdit();
		} else if (event.key === 'Dead' || event.key === 'Process') {
			beginEdit('');
		} else if (event.key.length === 1 && !command && !event.altKey) {
			event.preventDefault();
			if (fields[headCol]?.type !== 'check') beginEdit(event.key);
		}
	}

	function ondraftkeydown(event: KeyboardEvent): void {
		const step = event.shiftKey ? -1 : 1;
		if (event.key === 'Enter') {
			event.preventDefault();
			commitDraft({ down: step });
		} else if (event.key === 'Tab') {
			event.preventDefault();
			commitDraft({ across: step });
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelEdit();
		} else if (editing?.typed && event.key.startsWith('Arrow')) {
			event.preventDefault();
			if (event.key === 'ArrowDown') commitDraft({ down: 1 });
			else if (event.key === 'ArrowUp') commitDraft({ down: -1 });
			else if (event.key === 'ArrowRight') commitDraft({ across: 1 });
			else commitDraft({ across: -1 });
		}
	}

	function cellFrom(target: EventTarget | null): { r: number; c: number } | null {
		const element = target instanceof Element ? target.closest<HTMLElement>('td[data-c]') : null;
		return element === null ? null : { r: Number(element.dataset.r), c: Number(element.dataset.c) };
	}

	function cellAtPoint(x: number, y: number): { r: number; c: number } {
		const box = (scroller as HTMLElement).getBoundingClientRect();
		const r = Math.floor((y - box.top + scrollTop - rowHeight) / rowHeight);
		const inside = x - box.left;
		const across = inside >= stickyEnd ? inside + scrollLeft : inside;
		const c = lefts.findIndex((edge, index) => index > 0 && across < edge);
		return { r, c: (c === -1 ? fields.length : c) - 1 };
	}

	function scrollWhileDragging(point: { x: number; y: number }, step: () => void): () => void {
		let frame = requestAnimationFrame(function tick() {
			if (scroller !== undefined) {
				const box = scroller.getBoundingClientRect();
				const dx =
					point.x > box.right - 24
						? point.x - (box.right - 24)
						: point.x < box.left + stickyEnd
							? point.x - (box.left + stickyEnd)
							: 0;
				const dy =
					point.y > box.bottom - 24
						? point.y - (box.bottom - 24)
						: point.y < box.top + rowHeight
							? point.y - (box.top + rowHeight)
							: 0;
				if (dx !== 0 || dy !== 0) {
					scroller.scrollBy(dx / 4, dy / 4);
					scrollTop = scroller.scrollTop;
					scrollLeft = scroller.scrollLeft;
					step();
				}
			}
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}

	let pointerKind = 'mouse';
	let clickedActive = false;
	let dragged = false;

	function onbodypointerdown(event: PointerEvent): void {
		pointerKind = event.pointerType;
		const cell = cellFrom(event.target);
		if (
			cell === null ||
			event.pointerType === 'touch' ||
			event.button !== 0 ||
			(event.target as Element).closest('input') !== null
		) {
			return;
		}
		commitDraft({ leaving: true });
		clickedActive =
			focused && !event.shiftKey && !isRange && headRow === cell.r && headCol === cell.c;
		dragged = false;
		select(cell.r, cell.c, event.shiftKey);

		const point = { x: event.clientX, y: event.clientY };
		const extend = (): void => {
			const over = cellAtPoint(point.x, point.y);
			if (over.r !== headRow || over.c !== headCol) {
				dragged = true;
				select(over.r, over.c, true);
			}
		};
		const stopScroll = scrollWhileDragging(point, extend);
		const onmove = (move: PointerEvent): void => {
			point.x = move.clientX;
			point.y = move.clientY;
			extend();
		};
		const onup = (): void => {
			stopScroll();
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
		};
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
	}

	function onbodymousedown(event: MouseEvent): void {
		if (cellFrom(event.target) !== null && (event.target as Element).closest('input') === null) {
			event.preventDefault();
			if (pointerKind !== 'touch') table?.focus({ preventScroll: true });
		}
	}

	function onbodyclick(event: MouseEvent): void {
		const cell = cellFrom(event.target);
		if (cell === null || (event.target as Element).closest('input') !== null) return;
		const field = fields[cell.c];
		if (field === undefined) return;

		if (pointerKind === 'touch') {
			commitDraft({ leaving: true });
			select(cell.r, cell.c);
			beginEdit(undefined, true);
			return;
		}
		if (dragged || event.shiftKey) return;
		if (
			field.type === 'check' ||
			field.type === 'choice' ||
			field.type === 'link' ||
			clickedActive
		) {
			beginEdit();
		}
	}

	function rangeTsv(): string {
		return toTsv(
			rangeRows().map((row) =>
				rangeFields().map((field) => copyText(app.ws, field, cellValue(row, field, computed)))
			)
		);
	}

	function backToGrid(): void {
		clearTimeout(catcherRelease);
		if (catcher !== undefined) catcher.value = '';
		table?.focus({ preventScroll: true });
	}

	// WebKit fires no clipboard event on a page with nothing selected, so the shortcut's default action gets a selected field to act on.
	function armCatcher(text: string): void {
		if (catcher === undefined) return;
		catcher.value = text;
		catcher.focus({ preventScroll: true });
		catcher.select();
		clearTimeout(catcherRelease);
		catcherRelease = setTimeout(backToGrid, 100);
	}

	function oncatchercopy(event: ClipboardEvent, cut = false): void {
		if (event.clipboardData === null) return;
		event.clipboardData.setData('text/plain', catcher?.value ?? '');
		event.preventDefault();
		const count = (bottom - top + 1) * rangeFields().length;
		backToGrid();
		const undo = cut ? clearRange() : null;
		showToast(`${cut ? 'Cut' : 'Copied'} ${count} ${count === 1 ? 'cell' : 'cells'}`, undo);
	}

	function oncatcherpaste(event: ClipboardEvent): void {
		backToGrid();
		if (head === null || fields.length === 0) return;
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (text === '') return;
		event.preventDefault();
		const at = { row: top, col: left };
		const matrix = fillSelection(parseTsv(text), bottom - top + 1, right - left + 1);
		const paste = pasteChanges(app.ws, tableId, fields, rows, at, matrix);
		const count = paste.rows * paste.cols;
		const group = app.apply(paste.changes, count === 1 ? 'Cell pasted' : `${count} cells pasted`);
		const skipped =
			paste.skipped === 0
				? ''
				: `, ${paste.skipped} ${paste.skipped === 1 ? "value doesn't" : "values don't"} fit`;
		showToast(`Pasted ${count} ${count === 1 ? 'cell' : 'cells'}${skipped}`, group?.id ?? null);
		flushSync();
		if (paste.rows > 0 && paste.cols > 0) {
			select(at.row, at.col);
			select(at.row + paste.rows - 1, at.col + paste.cols - 1, true);
		}
	}

	function onresizedown(event: PointerEvent, field: FieldDef, index: number): void {
		event.preventDefault();
		event.stopPropagation();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const from = event.clientX;
		const width = widths[index];
		const onmove = (move: PointerEvent): void => {
			resizing = {
				field: field.id,
				width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + move.clientX - from)))
			};
		};
		const onup = (): void => {
			handle.removeEventListener('pointermove', onmove);
			handle.removeEventListener('pointerup', onup);
			if (resizing !== null) {
				const { width: next } = resizing;
				setConfig(
					{ widths: { ...view.config.widths, [field.id]: next } },
					`${field.name} resized`,
					applyCell
				);
			}
			resizing = null;
		};
		handle.addEventListener('pointermove', onmove);
		handle.addEventListener('pointerup', onup);
	}

	function refit(field: FieldDef): void {
		const measure = fitMeasure();
		if (measure !== null) {
			fitted = { ...fitted, [field.id]: fitOf(field, sampleRows(allRows), measure) };
		}
		if (view.config.widths?.[field.id] !== undefined) {
			const rest = { ...view.config.widths };
			delete rest[field.id];
			setConfig({ widths: rest }, `${field.name} refitted`, applyCell);
		}
	}

	function fitAll(): void {
		const measure = fitMeasure();
		if (measure !== null) {
			const sample = sampleRows(allRows);
			fitted = Object.fromEntries(
				app.ws.fields(tableId).map((field) => [field.id, fitOf(field, sample, measure)])
			);
		}
		if (Object.keys(view.config.widths ?? {}).length > 0) {
			setConfig({ widths: {} }, 'Columns fitted');
		}
	}

	function applyFill(from: Box, to: Box, series: boolean): void {
		const fill = fillChanges(app.ws, tableId, fields, rows, computed, from, to, series);
		if (fill.cells === 0) return;
		applyWithUndo(fill.changes, `Filled ${fill.cells} ${fill.cells === 1 ? 'cell' : 'cells'}`);
	}

	/** Ctrl+D and Ctrl+R: the first row or column copied over the rest, or the one before a single line. */
	function fillFromEdge(down: boolean): void {
		const box = { top: Math.max(0, top), bottom: Math.min(rows.length - 1, bottom), left, right };
		if (box.top > box.bottom) return;
		const [start, end] = down ? (['top', 'bottom'] as const) : (['left', 'right'] as const);
		if (box[start] === box[end]) {
			if (box[start] === 0) return;
			applyFill({ ...box, [start]: box[start] - 1, [end]: box[start] - 1 }, box, false);
		} else {
			applyFill({ ...box, [end]: box[start] }, { ...box, [start]: box[start] + 1 }, false);
		}
	}

	function onfilldown(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		dragged = true;
		const from = { top, bottom, left, right };
		const last = { top: 0, bottom: rows.length - 1, left: 0, right: fields.length - 1 };
		const pointer = { x: event.clientX, y: event.clientY };
		const update = (): void => {
			filling = fillTarget(from, cellAtPoint(pointer.x, pointer.y), last);
		};
		const stopScroll = scrollWhileDragging(pointer, update);
		const onmove = (move: PointerEvent): void => {
			pointer.x = move.clientX;
			pointer.y = move.clientY;
			update();
		};
		const onup = (): void => {
			stopScroll();
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
			const to = filling;
			filling = null;
			if (to === null) return;
			applyFill(from, to, true);
			flushSync();
			select(Math.min(from.top, to.top), Math.min(from.left, to.left));
			select(Math.max(from.bottom, to.bottom), Math.max(from.right, to.right), true);
		};
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
	}

	// Set by a menu item that opens something of its own, run once the menu has let focus go.
	let afterMenu: (() => void) | null = null;

	function onmenuclosed(event: Event): void {
		event.preventDefault();
		const next = afterMenu;
		afterMenu = null;
		if (next === null) table?.focus({ preventScroll: true });
		else next();
	}

	function columnAction(action: ColumnAction): void {
		const field = menuFieldDef;
		const anchor = menuAnchor;
		if (field === undefined || anchor === null) return;
		const index = app.ws.fields(tableId).findIndex((other) => other.id === field.id);
		if (action === 'rename') {
			afterMenu = () => {
				renameDraft = field.name;
				renaming = field.id;
			};
		} else if (action === 'formula') {
			afterMenu = () => (formulaEdit = { field: field.id, anchor, typed: '' });
		} else if (action === 'insert-left' || action === 'insert-right') {
			afterMenu = () => {
				insertAt = { anchor, at: index + (action === 'insert-right' ? 1 : 0) };
				inserting = true;
			};
		} else if (action === 'settings') {
			afterMenu = () => {
				fieldId = field.id;
				preset = null;
				fieldOpen = true;
			};
		} else if (action === 'hide') {
			setConfig({ hidden: [...(view.config.hidden ?? []), field.id] }, `${field.name} hidden`);
		} else if (action === 'fit') {
			fitAll();
		} else {
			const label = `Field "${field.name}" deleted`;
			applyWithUndo(deleteRecords(app.ws, [field.id]), label);
		}
	}

	function retype(type: FieldType): void {
		const field = menuFieldDef;
		if (field === undefined) return;
		if (type === 'link' || type === 'formula') {
			afterMenu = () => {
				fieldId = field.id;
				preset = { name: field.name, type };
				fieldOpen = true;
			};
			return;
		}
		const { changes, lost } = retypeField(
			app.ws,
			field.id,
			{ type },
			field.type === 'formula' ? computed : undefined
		);
		const label = `${field.name} retyped`;
		const group = app.apply(changes, label);
		showToast(
			lost === 0 ? label : `${label}, ${lost} ${lost === 1 ? 'value' : 'values'} cleared`,
			group?.id ?? null
		);
	}

	function renameField(field: FieldDef): void {
		const name = renameDraft.trim();
		renaming = null;
		if (name !== '' && name !== field.name) {
			applyWithUndo(updateRecord(app.ws, field.id, { name }), `Field "${name}" renamed`);
		}
		table?.focus({ preventScroll: true });
	}

	function onbodycontextmenu(event: MouseEvent): void {
		const target = event.target as Element;
		if (target.closest('input, textarea, thead') !== null) return;
		const header = target.closest<HTMLElement>('td[role="rowheader"]');
		const cell =
			cellFrom(target) ?? (header === null ? null : { r: Number(header.dataset.r), c: 0 });
		if (cell === null || cell.r >= rows.length) return;
		event.preventDefault();
		commitDraft({ leaving: true });
		const inside =
			head !== null && cell.r >= top && cell.r <= bottom && cell.c >= left && cell.c <= right;
		if (!inside) select(cell.r, cell.c);
		point = { x: event.clientX, y: event.clientY };
		rowMenuOpen = true;
	}

	function insertRow(below: boolean): void {
		const near = rows[below ? Math.min(bottom, rows.length - 1) : Math.max(0, top)];
		if (near === undefined) return;
		const ordered = app.ws.rows(tableId);
		const index = ordered.findIndex((row) => row.id === near.id);
		const created = (row: Rec | undefined): number | undefined => {
			const at = row?.data[CREATED];
			return typeof at === 'number' ? at : undefined;
		};
		const here = created(near) ?? Date.now();
		const next = created(ordered[index + (below ? 1 : -1)]);
		const at = next === undefined ? here + (below ? 1 : -1) : (here + next) / 2;
		const made = insertRows(app.ws, tableId, [todayDates()], at);
		applyWithUndo(made.changes, 'Row added');
		flushSync();
		selectPos(made.ids[0], fields[Math.max(0, headCol)]?.id ?? '');
	}

	function deleteRows(): void {
		const ids = rangeRows().map((row) => row.id);
		if (ids.length === 0) return;
		const label = ids.length === 1 ? 'Row deleted' : `${ids.length} rows deleted`;
		applyWithUndo(deleteRecords(app.ws, ids), label);
		flushSync();
		select(Math.min(Math.max(0, top), rows.length), Math.max(0, headCol));
	}

	async function copyRange(): Promise<void> {
		const count = rangeRows().length * rangeFields().length;
		try {
			await navigator.clipboard.writeText(rangeTsv());
			showToast(`Copied ${count} ${count === 1 ? 'cell' : 'cells'}`);
		} catch {
			showToast("Couldn't copy");
		}
	}

	function dropIndex(clientX: number): number {
		const box = (scroller as HTMLElement).getBoundingClientRect();
		const inside = clientX - box.left;
		const across = inside >= stickyEnd ? inside + scrollLeft : inside;
		for (let index = 0; index < fields.length; index += 1) {
			if (across < lefts[index] + widths[index] / 2) return index;
		}
		return fields.length;
	}

	function onheaderdown(event: PointerEvent, field: FieldDef): void {
		if (event.button !== 0 || event.pointerType === 'touch') return;
		const from = event.clientX;
		const point = { x: event.clientX, y: event.clientY + rowHeight * 2 };
		let stopScroll: (() => void) | null = null;

		const update = (): void => {
			columnDrag = { field: field.id, at: dropIndex(point.x) };
		};
		const onmove = (move: PointerEvent): void => {
			point.x = move.clientX;
			if (columnDrag === null && Math.abs(point.x - from) < DRAG_START) return;
			stopScroll ??= scrollWhileDragging(point, update);
			update();
		};
		const onup = (): void => {
			stopScroll?.();
			window.removeEventListener('pointermove', onmove);
			window.removeEventListener('pointerup', onup);
			const drag = columnDrag;
			columnDrag = null;
			if (drag !== null) {
				ignoreHeaderClick = true;
				setTimeout(() => (ignoreHeaderClick = false));
				moveField(field, drag.at);
			}
		};
		window.addEventListener('pointermove', onmove);
		window.addEventListener('pointerup', onup);
	}

	function moveField(field: FieldDef, at: number): void {
		const before = fields[at];
		const others = app.ws.fields(tableId).filter((other) => other.id !== field.id);
		const place =
			before === undefined ? others.length : others.findIndex((other) => other.id === before.id);
		if (place === -1 || before?.id === field.id) return;
		const ids = others.map((other) => other.id);
		ids.splice(place, 0, field.id);
		const changes = reorder(app.ws, ids);
		applyWithUndo(changes, `${field.name} moved`);
	}

	function openMenu(event: MouseEvent, field: FieldDef): void {
		if (ignoreHeaderClick) return;
		menuAnchor = (event.currentTarget as HTMLElement).closest('th');
		menuField = field.id;
		menuOpen = true;
	}

	const menuFieldDef = $derived(fields.find((field) => field.id === menuField));

	function backToTop(): void {
		if (scroller !== undefined) scroller.scrollTop = 0;
		scrollTop = 0;
	}

	function sortBy(field: FieldDef, dir: 'asc' | 'desc' | null): void {
		backToTop();
		setConfig(
			{ sort: dir === null ? null : { field: field.id, dir } },
			dir === null ? 'Sort cleared' : 'Sort changed'
		);
	}

	function settleFilter(): void {
		if (liveFilter === null || menuField === null) return;
		const text = liveFilter.trim();
		const saved = view.config.filter ?? null;
		const next =
			text === '' ? (saved?.field === menuField ? null : saved) : { field: menuField, text };
		liveFilter = null;
		if (JSON.stringify(next) !== JSON.stringify(saved)) {
			backToTop();
			setConfig({ filter: next }, next === null ? 'Filter cleared' : 'Filter changed');
		}
	}

	const pickerOptions = (
		field: FieldDef
	): { id: string; label: string; color?: string | null }[] =>
		field.type === 'choice'
			? field.choices.map((choice) => ({
					id: choice.name,
					label: choice.name,
					color: choice.color
				}))
			: linkOptions(app.ws, field.target);
</script>

{#snippet dataCell(row: Rec | null, r: number, field: FieldDef, c: number)}
	{@const inRange = r >= top && r <= bottom && c >= left && c <= right}
	{@const isActive = r === headRow && c === headCol}
	{@const key = row?.id ?? BLANK}
	{@const isEditing = editing?.row === key && editing.field === field.id}
	{@const value = row === null ? null : cellValue(row, field, computed)}
	{@const numeric = field.type === 'number' || field.type === 'formula'}
	<td
		id={cellId(r, c)}
		data-r={r}
		data-c={c}
		aria-colindex={c + 2}
		aria-selected={inRange}
		class="h-row border-r border-b border-b-rule p-0 {c === 0
			? 'sticky left-11 z-10 border-r-rule-strong bg-raised'
			: 'relative border-r-rule-col'}"
	>
		<div
			class="absolute inset-0 flex items-center overflow-hidden px-3 transition-colors motion-slow {numeric
				? 'justify-end'
				: ''} {field.type === 'check' ? 'justify-center' : ''} {inRange && isRange
				? 'bg-selected'
				: row !== null && fresh.has(row.id)
					? 'bg-tint-2'
					: 'group-hover:bg-tint'} {isActive
				? `ring-2 ring-inset ${focused ? 'ring-accent' : 'ring-edge'}`
				: ''}"
		>
			{#if field.type === 'check'}
				<span class="flex size-4 items-center justify-center rounded-box ring-1 ring-edge">
					<CellValue {field} {value} />
				</span>
			{:else if row === null && field.type === 'date'}
				<span class="truncate text-ink-3">{formatDate(todayIso())}</span>
			{:else if row === null && field.type !== 'formula'}
				<span class="truncate text-ink-3">{field.name}</span>
			{:else}
				<CellValue {field} {value} />
			{/if}
		</div>
		{#if isEditing && editing !== null}
			{#if field.type === 'choice' || field.type === 'link'}
				{@const target = editing}
				<GridPicker
					label={field.name}
					options={pickerOptions(field)}
					value={typeof value === 'string' ? value : null}
					{seed}
					creatable={field.type === 'choice'}
					onpick={(picked, down, across) => settle(target, picked, down, across, false)}
					onkeep={(down, across) => settle(target, undefined, down, across, false)}
					oncancel={() => {
						if (editing === target) cancelEdit();
					}}
				/>
			{:else}
				<input
					{@attach (node: HTMLInputElement) => {
						node.focus();
						if (node.type === 'text') node.setSelectionRange(node.value.length, node.value.length);
						if (node.type === 'date' || node.type === 'datetime-local') {
							try {
								node.showPicker();
							} catch {
								// No user activation or no `showPicker`: a second tap still opens it.
							}
						}
					}}
					class="absolute inset-y-0 -right-px left-0 z-1 h-full bg-raised px-3 ring-2 ring-accent outline-none ring-inset {numeric
						? 'text-right'
						: ''}"
					aria-label={field.name}
					placeholder={field.name}
					type={nativeDate ?? 'text'}
					inputmode={field.type === 'number' ? 'decimal' : undefined}
					enterkeyhint="done"
					autocomplete="off"
					bind:value={draft}
					onkeydown={ondraftkeydown}
					onblur={() => commitDraft({ leaving: true })}
				/>
			{/if}
		{/if}
		{#if r === bottom && c === right && row !== null && editing === null && filling === null}
			<div
				aria-hidden="true"
				class="absolute -right-1 -bottom-1 z-5 size-2 cursor-crosshair bg-accent ring-2 ring-raised pointer-coarse:hidden"
				onpointerdown={onfilldown}
			></div>
		{/if}
	</td>
{/snippet}

<div class="flex h-full flex-col">
	<textarea
		bind:this={catcher}
		class="pointer-events-none fixed top-0 left-0 size-px opacity-0"
		aria-hidden="true"
		tabindex="-1"
		oncopy={(event) => oncatchercopy(event)}
		oncut={(event) => oncatchercopy(event, true)}
		onpaste={oncatcherpaste}></textarea>
	{#if filterField}
		<div class="flex shrink-0 items-center gap-2 px-3 py-1 text-sm text-ink-2">
			<span class="min-w-0 truncate">
				{filterField.name} contains "{config.filter?.text}": {rows.length} of {allRows.length}
			</span>
			<Button variant="ghost" onclick={() => setConfig({ filter: null }, 'Filter cleared')}
				>Clear filter</Button
			>
		</div>
	{/if}

	<div
		bind:this={scroller}
		bind:clientHeight={viewHeight}
		bind:clientWidth={viewWidth}
		class="relative min-h-0 flex-1 overflow-auto"
		style="scroll-padding-left: {stickyEnd}px"
		{onscroll}
	>
		<div class="relative">
			<table
				bind:this={table}
				role="grid"
				tabindex="0"
				aria-rowcount={rows.length + 2}
				aria-colcount={fields.length + 1}
				aria-activedescendant={head !== null && headRow >= start && headRow < end
					? cellId(headRow, headCol)
					: undefined}
				class="w-full table-fixed border-separate border-spacing-0 select-none"
				style="outline: none"
				onfocus={() => {
					focused = true;
					if (head === null) select(0, 0);
				}}
				onblur={() => (focused = false)}
				{onkeydown}
				onpointerdown={onbodypointerdown}
				onmousedown={onbodymousedown}
				onclick={onbodyclick}
				oncontextmenu={onbodycontextmenu}
			>
				<colgroup>
					<col style="width: {NUMBER_WIDTH}px" />
					{#each fields as field, index (field.id)}
						<col style="width: {widths[index]}px" />
					{/each}
					<col style="width: {ADD_WIDTH}px" />
					<col />
				</colgroup>
				<thead>
					<tr aria-rowindex={1}>
						<th
							class="sticky top-0 left-0 z-30 border-r border-b border-r-rule-col border-b-rule-strong bg-band"
							aria-hidden="true"
						></th>
						{#each fields as field, index (field.id)}
							{@const numeric = field.type === 'number' || field.type === 'formula'}
							{@const sorted = view.config.sort?.field === field.id ? view.config.sort.dir : null}
							<th
								scope="col"
								aria-colindex={index + 2}
								aria-sort={sorted === 'asc'
									? 'ascending'
									: sorted === 'desc'
										? 'descending'
										: undefined}
								class="sticky top-0 h-row border-r border-b border-b-rule-strong bg-band p-0 text-sm font-medium text-ink-2 {index ===
								0
									? 'left-11 z-30 border-r-rule-strong'
									: 'z-20 border-r-rule-col'} {columnDrag?.field === field.id ? 'text-ink' : ''}"
							>
								{#if renaming === field.id}
									<input
										{@attach (node: HTMLInputElement) => {
											node.focus();
											node.select();
										}}
										class="{inputStyle} absolute inset-0 h-full rounded-none font-medium"
										aria-label="Name of {field.name}"
										placeholder={field.name}
										autocomplete="off"
										bind:value={renameDraft}
										onkeydown={(event) => {
											if (event.key === 'Enter') {
												event.preventDefault();
												renameField(field);
											} else if (event.key === 'Escape') {
												event.preventDefault();
												renaming = null;
												table?.focus({ preventScroll: true });
											}
										}}
										onblur={() => {
											if (renaming === field.id) renameField(field);
										}}
									/>
								{:else}
									<button
										type="button"
										class="absolute inset-0 flex items-center gap-1 px-3 whitespace-nowrap transition-colors motion hover:text-ink {numeric
											? 'justify-end'
											: field.type === 'check'
												? 'justify-center'
												: ''}"
										onpointerdown={(event) => onheaderdown(event, field)}
										onclick={(event) => openMenu(event, field)}
										oncontextmenu={(event) => {
											event.preventDefault();
											openMenu(event, field);
										}}
									>
										{#if field.type === 'formula'}<span>ƒ</span>{/if}
										<span class="min-w-0 truncate">{field.name}</span>
										{#if sorted !== null}
											<Icon name={sorted === 'asc' ? 'arrow-up' : 'arrow-down'} class="size-3" />
										{/if}
									</button>
								{/if}
								<div
									aria-hidden="true"
									class="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none hover:bg-tint-2 pointer-coarse:hidden"
									onpointerdown={(event) => onresizedown(event, field, index)}
									ondblclick={() => refit(field)}
								></div>
							</th>
						{/each}
						<th
							class="sticky top-0 z-20 border-r border-b border-r-rule-col border-b-rule-strong bg-band"
						>
							<AddField
								{tableId}
								bind:open={shell.addingField}
								class="absolute inset-0 flex items-center justify-center text-ink-3 transition-colors motion hover:text-ink"
								onmore={(name, type, at) => {
									fieldId = null;
									preset = { name, type, at };
									fieldOpen = true;
								}}
							/>
						</th>
						<th class="sticky top-0 z-20 border-b border-rule-strong bg-band" aria-hidden="true"
						></th>
					</tr>
				</thead>
				<tbody>
					{#if start > 0}
						<tr aria-hidden="true" style="height: {start * rowHeight}px">
							<td colspan={fields.length + 3} class="p-0"></td>
						</tr>
					{/if}
					{#each visible as row, offset (row.id)}
						{@const r = start + offset}
						<tr class="group" aria-rowindex={r + 2} data-fresh={fresh.has(row.id) || undefined}>
							<td
								role="rowheader"
								data-r={r}
								class="sticky left-0 z-10 h-row border-r border-b border-r-rule-col border-b-rule bg-band p-0"
							>
								<button
									type="button"
									class="absolute inset-0 flex items-center justify-end pr-2 text-xs text-ink-3 transition-colors motion group-hover:bg-tint hover:text-ink"
									aria-label="Open row"
									onclick={() => {
										rowId = row.id;
										rowOpen = true;
									}}>{r + 1}</button
								>
							</td>
							{#each fields as field, c (field.id)}
								{@render dataCell(row, r, field, c)}
							{/each}
							<td class="border-r border-b border-r-rule-col border-b-rule" aria-hidden="true"></td>
							<td class="border-b border-rule" aria-hidden="true"></td>
						</tr>
					{/each}
					{#if end < total}
						<tr aria-hidden="true" style="height: {(total - end) * rowHeight}px">
							<td colspan={fields.length + 3} class="p-0"></td>
						</tr>
					{/if}
					{#if showBlank}
						<tr class="group" aria-rowindex={rows.length + 2}>
							<td
								role="rowheader"
								class="sticky left-0 z-10 h-row border-r border-b border-r-rule-col border-b-rule bg-band p-0"
							>
								<button
									type="button"
									class="absolute inset-0 flex items-center justify-end pr-2 text-ink-3 transition-colors motion group-hover:bg-tint hover:text-ink"
									aria-label="Add row"
									onclick={() => {
										rowId = null;
										rowOpen = true;
									}}><Icon name="plus" class="size-3" /></button
								>
							</td>
							{#each fields as field, c (field.id)}
								{@render dataCell(null, rows.length, field, c)}
							{/each}
							<td class="border-r border-b border-r-rule-col border-b-rule" aria-hidden="true"></td>
							<td class="border-b border-rule" aria-hidden="true"></td>
						</tr>
					{/if}
				</tbody>
			</table>
			{#if isRange && head !== null}
				<div
					aria-hidden="true"
					class="pointer-events-none absolute ring-1 ring-accent ring-inset"
					style="left: {lefts[left]}px; top: {(top + 1) * rowHeight}px; width: {lefts[right + 1] -
						lefts[left]}px; height: {(bottom - top + 1) * rowHeight}px"
				></div>
			{/if}
			{#if filling !== null}
				<div
					aria-hidden="true"
					class="pointer-events-none absolute z-15 border border-dashed border-accent"
					style="top: {rowHeight * (filling.top + 1)}px; left: {lefts[
						filling.left
					]}px; width: {lefts[filling.right + 1] - lefts[filling.left]}px; height: {rowHeight *
						(filling.bottom - filling.top + 1)}px"
				></div>
			{/if}
			{#if columnDrag !== null}
				<div
					class="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-ink"
					style="left: {Math.max(
						lefts[columnDrag.at] ?? 0,
						columnDrag.at === 0 ? 0 : scrollLeft + stickyEnd
					)}px"
				></div>
			{/if}
		</div>
	</div>
</div>

<GridColumnMenu
	bind:open={menuOpen}
	anchor={menuAnchor}
	field={menuFieldDef}
	sorted={view.config.sort?.field === menuField ? (view.config.sort?.dir ?? null) : null}
	filter={config.filter?.field === menuField ? (config.filter?.text ?? '') : ''}
	onsort={(dir) => {
		if (menuFieldDef) sortBy(menuFieldDef, dir);
	}}
	onfilter={(text) => (liveFilter = text)}
	onretype={retype}
	onaction={columnAction}
	onCloseAutoFocus={onmenuclosed}
/>
<div
	bind:this={pointAnchor}
	aria-hidden="true"
	class="pointer-events-none fixed size-0"
	style="left: {point.x}px; top: {point.y}px"
></div>
<GridRowMenu
	bind:open={rowMenuOpen}
	anchor={pointAnchor}
	rows={rangeRows().length}
	cells={rangeRows().length * rangeFields().length}
	oninsert={insertRow}
	ondelete={deleteRows}
	oncopy={() => void copyRange()}
	onCloseAutoFocus={onmenuclosed}
/>
{#if insertAt !== null}
	<AddField
		{tableId}
		bind:open={inserting}
		anchor={insertAt.anchor}
		at={insertAt.at}
		onmore={(name, type, at) => {
			fieldId = null;
			preset = { name, type, at };
			fieldOpen = true;
		}}
	/>
{/if}
{#if formulaEdit !== null}
	{@const edited = app.ws.field(formulaEdit.field)}
	{#if edited !== undefined}
		<FormulaEditor
			field={edited}
			anchor={formulaEdit.anchor}
			typed={formulaEdit.typed}
			onclose={() => {
				formulaEdit = null;
				table?.focus({ preventScroll: true });
			}}
		/>
	{/if}
{/if}
<RowSheet bind:open={rowOpen} {tableId} {rowId} />
<FieldSheet bind:open={fieldOpen} {tableId} {fieldId} {preset} />
