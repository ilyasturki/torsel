import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DATA_COLORS } from './colors.ts';

type Rgba = [number, number, number, number];
type Tokens = Record<string, string>;

const css = readFileSync('src/app.css', 'utf8');
const DARK = '@media (prefers-color-scheme: dark)';

function block(text: string): Tokens {
	return Object.fromEntries(
		[...text.matchAll(/--([\w-]+):\s*([^;]+);/gu)].map(([, k, v]) => [k, v.trim()])
	);
}

const light = block(css.slice(css.indexOf(':root {'), css.indexOf(DARK)));
const dark = {
	...light,
	...block(css.slice(css.indexOf(DARK), css.indexOf('@media (pointer: coarse)')))
};

function parse(value: string, tokens: Tokens): Rgba {
	const ref = /^var\(--([\w-]+)\)$/u.exec(value);
	if (ref) return parse(tokens[ref[1]], tokens);
	if (value.startsWith('#')) {
		const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
		return [r, g, b, 1];
	}
	const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/u.exec(value);
	if (!rgb) throw new Error(`unreadable colour ${value}`);
	return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
}

function over(top: Rgba, under: Rgba): Rgba {
	const mix = (i: number) => top[i] * top[3] + under[i] * (1 - top[3]);
	return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
	const linear = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** `field@float` is the field's fill laid over the float surface. */
function surface(spec: string, tokens: Tokens): Rgba {
	const layers = spec.split('@');
	return layers
		.slice(0, -1)
		.reduceRight(
			(under, name) => over(parse(tokens[name], tokens), under),
			parse(tokens[layers.at(-1)!], tokens)
		);
}

const SURFACES = [
	'canvas',
	'raised',
	'float',
	'band',
	'selected',
	'field@raised',
	'field-hover@raised',
	'field@float',
	'field-hover@float',
	'tint-2@raised',
	'tint-2@float'
];
const INKS = ['ink', 'ink-2', 'ink-3', 'accent'];
const BUTTONS = ['button@raised', 'button-hover@raised', 'button@float', 'button-hover@float'];

describe.each([
	['light', light],
	['dark', dark]
])('%s theme', (_, tokens) => {
	it.each(INKS.flatMap((ink) => SURFACES.map((on) => [ink, on])))(
		'%s on %s reads at 4.5:1',
		(ink, on) => {
			const under = surface(on, tokens);
			expect(ratio(over(parse(tokens[ink], tokens), under), under)).toBeGreaterThanOrEqual(4.5);
		}
	);

	it.each(BUTTONS.map((on) => [on]))('ink on %s reads at 4.5:1', (on) => {
		expect(ratio(parse(tokens.ink, tokens), surface(on, tokens))).toBeGreaterThanOrEqual(4.5);
	});

	it.each(DATA_COLORS.map((color) => [color]))(
		'ink, ink-3 and the %s tag read on its row tint',
		(color) => {
			const tint = parse(tokens[`d-${color}-tint`], tokens);
			expect(ratio(parse(tokens.ink, tokens), tint)).toBeGreaterThanOrEqual(4.5);
			expect(ratio(parse(tokens['ink-3'], tokens), tint)).toBeGreaterThanOrEqual(4.5);
			expect(
				ratio(parse(tokens[`d-${color}-fg`], tokens), parse(tokens[`d-${color}-bg`], tokens))
			).toBeGreaterThanOrEqual(4.5);
		}
	);

	it.each(DATA_COLORS.flatMap((color) => [1, 2, 3, 4, 5].map((step) => [color, step])))(
		'ink reads on %s scale step %i',
		(color, step) => {
			expect(
				ratio(parse(tokens.ink, tokens), parse(tokens[`d-${color}-${step}`], tokens))
			).toBeGreaterThanOrEqual(4.5);
		}
	);

	it.each(DATA_COLORS.map((color) => [color]))('%s as a bar on the panel reads at 3:1', (color) => {
		expect(
			ratio(parse(tokens[`d-${color}`], tokens), surface('raised', tokens))
		).toBeGreaterThanOrEqual(3);
	});
});
