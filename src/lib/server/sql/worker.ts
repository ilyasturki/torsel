import { parentPort, workerData } from 'node:worker_threads';

import { chartData } from '../../core/chart.ts';
import type { MemoryEngine, Sqlite3 } from '../../core/memory-engine.ts';
import { memoryEngine } from '../../core/memory-engine.ts';
import {
	QueryError,
	computedCells,
	formulaCells,
	formulaProblem,
	formulaValues,
	materializeBase,
	readQuery
} from '../../core/sql.ts';
import { Workspace } from '../../core/workspace.ts';
import type { SqlJob, SqlReply, SqlResult } from './jobs.ts';

// sqlite-wasm warns with the failed statement's text, which is the person's SQL: none of it reaches the logs.
(globalThis as { sqlite3ApiConfig?: object }).sqlite3ApiConfig = { warn: () => undefined };

const { default: init } = (await import(workerData.sqlite as string)) as {
	default: () => Promise<Sqlite3>;
};
const sqlite3 = await init();

function run(engine: MemoryEngine, ws: Workspace, job: SqlJob): SqlResult[SqlJob['task']['kind']] {
	const { task } = job;
	materializeBase(engine, ws, job.base, task.kind === 'query');
	engine.readOnly();
	engine.bound(job.limits);

	switch (task.kind) {
		case 'query':
			return readQuery(engine, task.sql, { offset: task.offset });
		case 'formula-problem':
			return formulaProblem(engine, ws, task.table, task.stored);
		case 'formula-values':
			return [...formulaValues(engine, ws, task.table, task.stored)];
		case 'formula-cells':
			return formulaCells(engine, task.table, task.fields, task.rows);
		case 'computed':
			return computedCells(engine, ws, task.table);
		case 'chart':
			return chartData(engine, ws, task.table, task.config, task.only);
	}
}

function answer(job: SqlJob): SqlReply {
	const ws = new Workspace();
	for (const rec of job.records) {
		ws.put(rec);
	}

	const engine = memoryEngine(sqlite3);
	try {
		return { id: job.id, ok: true, result: run(engine, ws, job) };
	} catch (error) {
		return { id: job.id, ok: false, error: error instanceof QueryError ? error.message : 'failed' };
	} finally {
		engine.close();
	}
}

parentPort?.on('message', (job: SqlJob) => {
	parentPort?.postMessage(answer(job));
});
