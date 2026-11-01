import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

// The servers in front of the fake take this many prompts per account a day; no spec but the cap's sends more.
export const DAILY_LIMIT = 4;

export type FakeBlock =
	| { type: 'note'; text: string }
	| { type: 'text'; text: string }
	| { type: 'tool'; id: string; name: string; input: unknown };

export type FakeStep = {
	blocks: FakeBlock[];
	stop?: 'end_turn' | 'tool_use' | 'refusal';
	// Text of the last block streamed before the response waits for `release`, or is cut off.
	holdAfter?: string;
	// An SSE `error` event, since the SDK retries a 5xx status on its own.
	failAfter?: string;
};

type Script = {
	steps: FakeStep[];
	requests: { messages: unknown[]; body: Record<string, unknown> }[];
	aborted: number;
	release: (() => void) | null;
};

const scripts = new Map<string, Script>();

function scriptFor(messages: unknown[]): Script | undefined {
	const text = JSON.stringify(messages);
	return [...scripts].find(([key]) => text.includes(key))?.[1];
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = '';
		request.on('data', (chunk) => {
			body += String(chunk);
		});
		request.on('end', () => resolve(body));
	});
}

function send(response: ServerResponse, event: string, data: unknown): void {
	response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chunks(text: string): string[] {
	return text.match(/\S+\s*|\s+/gu) ?? [];
}

async function stream(step: FakeStep, script: Script, response: ServerResponse): Promise<void> {
	response.writeHead(200, { 'content-type': 'text/event-stream' });

	const hasTool = step.blocks.some((block) => block.type === 'tool');
	send(response, 'message_start', {
		type: 'message_start',
		message: {
			id: `msg_${script.requests.length}`,
			type: 'message',
			role: 'assistant',
			model: 'fake',
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 }
		}
	});

	for (const [index, block] of step.blocks.entries()) {
		if (block.type === 'tool') {
			send(response, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} }
			});
			send(response, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
			});
		} else if (block.type === 'note') {
			send(response, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: { type: 'thinking', thinking: '', signature: '' }
			});
			send(response, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'thinking_delta', thinking: block.text }
			});
			send(response, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'signature_delta', signature: `sig-${index}-${script.requests.length}` }
			});
		} else {
			send(response, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: { type: 'text', text: '' }
			});
			for (const text of chunks(block.text)) {
				send(response, 'content_block_delta', {
					type: 'content_block_delta',
					index,
					delta: { type: 'text_delta', text }
				});
			}
			if (step.holdAfter === block.text) {
				await new Promise<void>((resolve) => {
					script.release = resolve;
					response.once('close', resolve);
				});
			}
			if (step.failAfter === block.text) {
				send(response, 'error', {
					type: 'error',
					error: { type: 'overloaded_error', message: 'scripted failure' }
				});
				response.end();
				return;
			}
		}
		send(response, 'content_block_stop', { type: 'content_block_stop', index });
	}

	send(response, 'message_delta', {
		type: 'message_delta',
		delta: { stop_reason: step.stop ?? (hasTool ? 'tool_use' : 'end_turn'), stop_sequence: null },
		usage: { output_tokens: 1 }
	});
	send(response, 'message_stop', { type: 'message_stop' });
	response.end();
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const url = new URL(request.url ?? '/', 'http://fake');
	const key = url.searchParams.get('key') ?? '';

	if (url.pathname === '/__script') {
		const { steps } = JSON.parse(await readBody(request)) as { steps: FakeStep[] };
		scripts.set(key, { steps, requests: [], aborted: 0, release: null });
		response.end('{}');
		return;
	}

	if (url.pathname === '/__seen') {
		const script = scripts.get(key);
		response.setHeader('content-type', 'application/json');
		response.end(
			JSON.stringify({ requests: script?.requests ?? [], aborted: script?.aborted ?? 0 })
		);
		return;
	}

	if (url.pathname === '/__release') {
		scripts.get(key)?.release?.();
		response.end('{}');
		return;
	}

	if (url.pathname === '/v1/messages') {
		const body = JSON.parse(await readBody(request)) as Record<string, unknown> & {
			messages: unknown[];
		};
		const script = scriptFor(body.messages);
		const step = script?.steps[script.requests.length];
		if (script === undefined || step === undefined) {
			response.writeHead(400, { 'content-type': 'application/json' });
			response.end(
				JSON.stringify({
					type: 'error',
					error: { type: 'invalid_request_error', message: 'no scripted reply for this request' }
				})
			);
			return;
		}
		script.requests.push({ messages: body.messages, body });
		response.once('close', () => {
			if (!response.writableEnded) {
				script.aborted += 1;
			}
		});
		await stream(step, script, response);
		return;
	}

	response.writeHead(404);
	response.end();
}

export function startFake(): Promise<{ url: string; close(): void }> {
	const server = createServer((request, response) => void handle(request, response));
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
		});
	});
}
