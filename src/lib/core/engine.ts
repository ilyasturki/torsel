import init from '@sqlite.org/sqlite-wasm';

import type { MemoryEngine } from './memory-engine.ts';
import { memoryEngine } from './memory-engine.ts';

export type { EngineLimits, MemoryEngine } from './memory-engine.ts';

let loading: ReturnType<typeof init> | undefined;

// The same WebAssembly build on every device and on the server: one engine, one set of numbers.
export async function openEngine(): Promise<MemoryEngine> {
	return memoryEngine(await (loading ??= init()));
}
