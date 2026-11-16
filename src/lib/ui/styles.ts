/** Keyboard focus on anything pressed: a ring outside the control, on whatever surface it sits. */
export const focus =
	'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const fieldFill = 'bg-field ring-1 ring-field-edge ring-inset hover:bg-field-hover';

/** Where the typing goes, mouse or keyboard; `focus-within` on a wrapper that holds a bare field. */
export const fieldFocus =
	'outline-none focus:bg-field-hover focus:ring-1 focus:ring-focus focus:ring-inset';
export const fieldFocusWithin =
	'focus-within:bg-field-hover focus-within:ring-1 focus-within:ring-focus focus-within:ring-inset';

export const input = `motion h-control w-full min-w-0 rounded-box px-2 text-ink transition-colors placeholder:text-ink-3 ${fieldFill} ${fieldFocus}`;

export const secondary = 'bg-button text-ink hover:bg-button-hover';

export const linkButton = `motion inline-flex h-control items-center justify-center rounded-box px-3 font-medium transition-colors ${secondary} ${focus}`;

export const textarea = `motion w-full min-w-0 rounded-box p-2 font-mono text-ink transition-colors placeholder:text-ink-3 ${fieldFill} ${fieldFocus}`;

export const checkbox = `size-4 shrink-0 accent-current ${focus}`;

export const legend = 'mb-1 text-sm font-medium text-ink-2';

export const chip = `motion inline-flex h-control shrink-0 items-center gap-2 rounded-box px-3 font-medium transition-colors ${focus}`;
export const chipOff = 'bg-button text-ink-2 hover:bg-button-hover hover:text-ink';
export const chipOn = 'bg-fill text-on-fill';

/** A row of a menu or a list of options; bits-ui marks the one under the pointer or the keys. */
export const menuItem =
	'motion flex h-control w-full cursor-default items-center gap-2 rounded-box px-2 text-ink outline-none transition-colors select-none data-disabled:text-ink-3 data-highlighted:bg-tint-2';

export const popup = 'z-50 rounded-panel bg-float p-1 shadow-float outline-none';

/** A word of a sentence that opens a menu, as a chart's settings line has. */
export const token = `motion inline-flex h-control items-center gap-1 rounded-box bg-tint pr-1.5 pl-2 font-medium text-ink transition-colors hover:bg-tint-2 aria-expanded:bg-tint-2 ${focus}`;
