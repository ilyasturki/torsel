import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

// The servers in front of the fake take this many prompts per account a day; no spec but the cap's sends more.
export const DAILY_LIMIT = 4;

/** A page a scripted search found, and what a reply cites of it. */
export type FakeResult = { url: string; title: string };

export type FakeBlock =
	| { type: 'note'; text: string }
	| { type: 'text'; text: string; cites?: (FakeResult & { cited: string })[] }
	| { type: 'tool'; id: string; name: string; input: unknown }
	| { type: 'search'; id: string; query: string }
	| { type: 'found'; id: string; results: FakeResult[] };

export type FakeStep = {
	blocks: FakeBlock[];
	stop?: 'end_turn' | 'tool_use' | 'refusal' | 'pause_turn';
	// Text of the last block streamed before the response waits for `release`, or is cut off.
	holdAfter?: string;
	// An SSE `error` event, since the SDK retries a 5xx status on its own.
	failAfter?: string;
	// Id of the tool block streamed before the response waits for `release`.
	holdAt?: string;
};

/** What an empty thread offers, answered apart from the steps when the screen holds the key. */
export type FakeSuggestion = { text: string; complete: boolean };

/** The thread's title call, answered apart from the steps: by default the message without its key. */
export type FakeTitle = { title?: string; hold?: boolean; fail?: boolean };

type Script = {
	steps: FakeStep[];
	requests: { messages: unknown[]; body: Record<string, unknown> }[];
	aborted: number;
	release: (() => void) | null;
	title: FakeTitle;
	titles: Record<string, unknown>[];
	releaseTitle: (() => void) | null;
	suggest: FakeSuggestion[];
	suggests: Record<string, unknown>[];
};

const scripts = new Map<string, Script>();

function scriptFor(messages: unknown[]): [string, Script] | undefined {
	const text = JSON.stringify(messages);
	return [...scripts].find(([key]) => text.includes(key));
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
			if (step.holdAt === block.id) {
				await new Promise<void>((resolve) => {
					script.release = resolve;
					response.once('close', resolve);
				});
			}
		} else if (block.type === 'search') {
			send(response, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: { type: 'server_tool_use', id: block.id, name: 'web_search', input: {} }
			});
			send(response, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: block.query }) }
			});
			if (step.holdAt === block.id) {
				await new Promise<void>((resolve) => {
					script.release = resolve;
					response.once('close', resolve);
				});
			}
		} else if (block.type === 'found') {
			send(response, 'content_block_start', {
				type: 'content_block_start',
				index,
				content_block: {
					type: 'web_search_tool_result',
					tool_use_id: block.id,
					content: block.results.map((result) => ({
						type: 'web_search_result',
						...result,
						encrypted_content: 'fake',
						page_age: null
					}))
				}
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
			for (const cite of block.cites ?? []) {
				send(response, 'content_block_delta', {
					type: 'content_block_delta',
					index,
					delta: {
						type: 'citations_delta',
						citation: {
							type: 'web_search_result_location',
							url: cite.url,
							title: cite.title,
							cited_text: cite.cited,
							encrypted_index: 'fake'
						}
					}
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

function isTitleCall(body: Record<string, unknown>): boolean {
	return String(body.system).startsWith('Name this conversation');
}

function isSuggestCall(body: Record<string, unknown>): boolean {
	return String(body.system).startsWith('Suggest what the person');
}

function answerJson(response: ServerResponse, value: unknown): void {
	response.setHeader('content-type', 'application/json');
	response.end(
		JSON.stringify({
			id: 'msg_json',
			type: 'message',
			role: 'assistant',
			model: 'fake',
			content: [{ type: 'text', text: JSON.stringify(value) }],
			stop_reason: 'end_turn',
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 }
		})
	);
}

async function answerTitle(
	key: string,
	script: Script,
	body: Record<string, unknown>,
	response: ServerResponse
): Promise<void> {
	script.titles.push(body);
	if (script.title.hold) {
		await new Promise<void>((resolve) => {
			script.releaseTitle = resolve;
			response.once('close', resolve);
		});
	}
	if (script.title.fail) {
		response.writeHead(400, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({
				type: 'error',
				error: { type: 'invalid_request_error', message: 'scripted title failure' }
			})
		);
		return;
	}
	const asked = /<message>([\s\S]*)<\/message>/u.exec(JSON.stringify(body.messages))?.[1] ?? '';
	const title = script.title.title ?? asked.replace(key, '').trim();
	answerJson(response, { title });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const url = new URL(request.url ?? '/', 'http://fake');
	const key = url.searchParams.get('key') ?? '';

	if (url.pathname === '/__script') {
		const { steps, title, suggest } = JSON.parse(await readBody(request)) as {
			steps: FakeStep[];
			title?: FakeTitle;
			suggest?: FakeSuggestion[];
		};
		scripts.set(key, {
			steps,
			requests: [],
			aborted: 0,
			release: null,
			title: title ?? {},
			titles: [],
			releaseTitle: null,
			suggest: suggest ?? [],
			suggests: []
		});
		response.end('{}');
		return;
	}

	if (url.pathname === '/__seen') {
		const script = scripts.get(key);
		response.setHeader('content-type', 'application/json');
		response.end(
			JSON.stringify({
				requests: script?.requests ?? [],
				aborted: script?.aborted ?? 0,
				titles: script?.titles ?? [],
				suggests: script?.suggests ?? []
			})
		);
		return;
	}

	if (url.pathname === '/__release') {
		scripts.get(key)?.release?.();
		response.end('{}');
		return;
	}

	if (url.pathname === '/__release-title') {
		scripts.get(key)?.releaseTitle?.();
		response.end('{}');
		return;
	}

	if (url.pathname === '/v1/messages') {
		const body = JSON.parse(await readBody(request)) as Record<string, unknown> & {
			messages: unknown[];
		};
		const found = scriptFor(body.messages);
		if (found !== undefined && isSuggestCall(body)) {
			found[1].suggests.push(body);
			answerJson(response, { suggestions: found[1].suggest });
			return;
		}
		if (found !== undefined && isTitleCall(body)) {
			await answerTitle(found[0], found[1], body, response);
			return;
		}
		const script = found?.[1];
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
