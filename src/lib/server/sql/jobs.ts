import type { EngineLimits } from '../../core/memory-engine.ts';
import type { Rec } from '../../core/model.ts';
import type { QueryPage, SqlValue } from '../../core/sql.ts';

export type SqlTask =
	| { kind: 'query'; sql: string; offset: number }
	| { kind: 'formula-problem'; table: string; stored: string }
	| { kind: 'formula-values'; table: string; stored: string };

export type SqlResult = {
	query: QueryPage;
	'formula-problem': string | null;
	'formula-values': [string, SqlValue][];
};

export type SqlJob = {
	id: number;
	records: Rec[];
	base: string;
	limits: EngineLimits;
	task: SqlTask;
};

export type SqlReply =
	| { id: number; ok: true; result: SqlResult[SqlTask['kind']] }
	| { id: number; ok: false; error: string };
