import { FormulaError, toStored } from '../core/formula.ts';
import { app } from './app.svelte.ts';

/** A field can't name itself, so `fieldId` is left out of the names a formula may use. */
export function readFormula(
	tableId: string,
	fieldId: string | null,
	text: string
): { expr: string } | { problem: string } {
	let expr: string;
	try {
		expr = toStored(
			text,
			app.ws.fields(tableId).filter((field) => field.id !== fieldId)
		);
	} catch (error) {
		return { problem: error instanceof FormulaError ? error.message : String(error) };
	}
	const refused = app.checkFormula(tableId, expr);
	return refused === null ? { expr } : { problem: `SQLite refused the formula: ${refused}` };
}
