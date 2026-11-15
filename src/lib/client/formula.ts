import { FormulaError, toStored } from '../core/formula.ts';
import { formulaProblem, fields as words } from '../i18n/fields.ts';
import { app } from './app.svelte.ts';

function problemText(error: unknown): string {
	return error instanceof FormulaError ? formulaProblem(words, error) : String(error);
}

/** A field can't name itself, so `fieldId` is left out of the names a formula may use. */
export function readFormula(
	tableId: string,
	fieldId: string | null,
	text: string
): { expr: string } | { problem: string } {
	let expr: string;
	let refused: string | null;
	try {
		expr = toStored(
			text,
			app.ws.fields(tableId).filter((field) => field.id !== fieldId)
		);
		refused = app.checkFormula(tableId, expr);
	} catch (error) {
		return { problem: problemText(error) };
	}
	return refused === null ? { expr } : { problem: words.sqliteRefused(refused) };
}
