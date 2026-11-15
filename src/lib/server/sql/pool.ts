import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { Rec } from '../../core/model.ts';
import type { SqlJob, SqlReply, SqlResult, SqlTask } from './jobs.ts';

export type SqlLimits = {
	/** The engine's own deadline for one statement. */
	ms: number;
	/** The longest string or blob a statement may build. */
	length: number;
	/** How long the main side waits for a whole job before it kills the worker. */
	backstop: number;
};

export const SQL_LIMITS: SqlLimits = { ms: 500, length: 1_000_000, backstop: 3_000 };

export class SqlRefusal extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'SqlRefusal';
	}
}

type Job = {
	job: SqlJob;
	backstop: number;
	resolve(result: unknown): void;
	reject(error: Error): void;
};

type Slot = { worker: Worker | null; job: Job | null; timer?: ReturnType<typeof setTimeout> };

function spawn(): Worker {
	const source = import.meta.env.SQL_WORKER;
	if (source === undefined) {
		throw new Error('the SQL worker was not bundled: add sqlWorker() to the Vite config');
	}
	// The worker is a data: module, which resolves no bare specifier: it gets SQLite's file URL.
	const sqlite = pathToFileURL(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm'));
	const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
		workerData: { sqlite: sqlite.href }
	});
	worker.unref();
	return worker;
}

/** Workers that run SQL written by a client, off the thread every account's requests share. */
export class SqlPool {
	private readonly slots: Slot[];
	private readonly queue: Job[] = [];
	private nextId = 1;

	public constructor(size: number) {
		this.slots = Array.from({ length: size }, () => ({ worker: null, job: null }));
	}

	public run<K extends SqlTask['kind']>(
		records: Rec[],
		base: string,
		task: Extract<SqlTask, { kind: K }>,
		limits: SqlLimits = SQL_LIMITS
	): Promise<SqlResult[K]> {
		return new Promise((resolve, reject) => {
			this.queue.push({
				job: {
					id: this.nextId++,
					records,
					base,
					limits: { ms: limits.ms, length: limits.length },
					task
				},
				backstop: limits.backstop,
				resolve: resolve as (result: unknown) => void,
				reject
			});
			this.pump();
		});
	}

	/** Ends every worker; a later job spawns new ones. */
	public async close(): Promise<void> {
		await Promise.all(this.slots.map((slot) => this.stop(slot, new SqlRefusal('closed'))));
	}

	private pump(): void {
		for (const slot of this.slots) {
			while (slot.job === null) {
				const next = this.queue.shift();
				if (next === undefined) return;
				this.start(slot, next);
			}
		}
	}

	private start(slot: Slot, job: Job): void {
		let worker: Worker;
		try {
			worker = slot.worker ?? this.attach(slot);
		} catch (error) {
			job.reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		slot.job = job;
		worker.ref();
		slot.timer = setTimeout(() => {
			void this.stop(slot, new SqlRefusal('interrupted'));
		}, job.backstop);
		worker.postMessage(job.job);
	}

	private attach(slot: Slot): Worker {
		const worker = spawn();
		slot.worker = worker;
		worker.on('message', (reply: SqlReply) => {
			const job = slot.job;
			if (job === null || reply.id !== job.job.id) return;
			this.settle(slot);
			if (reply.ok) {
				job.resolve(reply.result);
			} else {
				job.reject(new SqlRefusal(reply.error));
			}
			this.pump();
		});
		worker.on('error', () => {
			if (slot.worker === worker) {
				void this.stop(slot, new SqlRefusal('failed'));
			}
		});
		worker.on('exit', () => {
			if (slot.worker === worker) {
				void this.stop(slot, new SqlRefusal('failed'));
			}
		});
		return worker;
	}

	private settle(slot: Slot): void {
		clearTimeout(slot.timer);
		slot.job = null;
		slot.worker?.unref();
	}

	private async stop(slot: Slot, reason: Error): Promise<void> {
		const { worker, job } = slot;
		slot.worker = null;
		this.settle(slot);
		job?.reject(reason);
		await worker?.terminate();
		this.pump();
	}
}

export const sqlPool = new SqlPool(2);
