import type { Database } from '../db/client.ts';
import type { McpCaller } from './mcp.ts';
import { serveMcp } from './mcp.ts';

export function within<T>(promise: Promise<T>, ms = 3000): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_settle, fail) =>
			setTimeout(() => fail(new Error(`still pending after ${ms} ms`)), ms)
		)
	]);
}

export async function callTool(
	db: Database,
	caller: McpCaller,
	name: string,
	args: unknown
): Promise<{ isError?: boolean; text: string }> {
	const response = await serveMcp(
		db,
		caller,
		new Request('http://torsel.test/api/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args }
			})
		}),
		'test'
	);
	const body = await response.text();
	const { result } = JSON.parse(
		body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? '')
	) as { result: { isError?: boolean; content: { text: string }[] } };
	return { isError: result.isError, text: result.content[0].text };
}
