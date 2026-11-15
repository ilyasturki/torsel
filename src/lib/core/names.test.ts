import { describe, expect, it } from 'vitest';

import names from '#lib/i18n/names.ts';

import { fieldSpecs, guessColumns } from './csv.ts';
import { nameTaken, numberedName } from './names.ts';

describe('names', () => {
	it('finds a name taken whatever its case and spaces, leaving out the one renamed', () => {
		const tables = [
			{ id: 't1', name: 'Sets' },
			{ id: 't2', name: 'Runs' }
		];

		expect(nameTaken(tables, ' sets ')).toEqual({ id: 't1', name: 'Sets' });
		expect(nameTaken(tables, 'Sets', 't1')).toBeUndefined();
		expect(nameTaken(tables, 'Lifts')).toBeUndefined();
	});

	it('numbers a name already taken', () => {
		expect(numberedName(['Sets'], 'Lifts')).toBe('Lifts');
		expect(numberedName(['Sets', 'sets (2)'], ' Sets ')).toBe('Sets (3)');
	});

	it('numbers a header the file repeats, and one the table already has', () => {
		const columns = guessColumns(
			[
				['Weight', 'weight', 'Reps'],
				['80', '82', '8']
			],
			names.en
		);

		expect(fieldSpecs(columns).map((spec) => spec.name)).toEqual(['Weight', 'weight (2)', 'Reps']);
		expect(fieldSpecs(columns, ['Reps']).map((spec) => spec.name)).toEqual([
			'Weight',
			'weight (2)',
			'Reps (2)'
		]);
	});
});
