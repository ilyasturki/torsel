import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const fromStatic = (file: string) => readFileSync(join('static', file));
const pngSize = (png: Buffer) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

type Icon = { src: string; sizes: string; purpose?: string };

const manifest: { start_url: string; icons: Icon[] } = JSON.parse(
	fromStatic('manifest.webmanifest').toString()
);

describe('web app manifest', () => {
	it('opens on the app', () => {
		expect(manifest.start_url).toBe('/app');
	});

	it('lists icons that exist at their declared size', () => {
		for (const icon of manifest.icons) {
			expect(pngSize(fromStatic(icon.src)), icon.src).toBe(icon.sizes);
		}
	});

	it('has 192 and 512 icons, each also maskable', () => {
		const sizes = (maskable: boolean) =>
			manifest.icons
				.filter((icon) => (icon.purpose === 'maskable') === maskable)
				.map((icon) => icon.sizes);
		expect(sizes(false)).toEqual(['192x192', '512x512']);
		expect(sizes(true)).toEqual(['192x192', '512x512']);
	});
});

describe('browser icons', () => {
	it('favicon.svg follows the colour scheme', () => {
		expect(fromStatic('favicon.svg').toString()).toContain('prefers-color-scheme:dark');
	});

	it('favicon.ico holds 16, 32 and 48px images', () => {
		const ico = fromStatic('favicon.ico');
		const widths = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]);
		expect(widths).toEqual([16, 32, 48]);
	});

	it('apple-touch-icon is 180px', () => {
		expect(pngSize(fromStatic('apple-touch-icon.png'))).toBe('180x180');
	});

	it('the social card base is 1200x630', () => {
		expect(pngSize(fromStatic('og-base.png'))).toBe('1200x630');
	});
});
