import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { createUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import type { McpCaller } from './mcp.ts';
import { serveMcp } from './mcp.ts';

type Mode = 'legacy' | 'auto' | { pin: string };

async function connect(mode: Mode, access: McpCaller['access'] = 'write'): Promise<Client> {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const user = await createUser(db, 'me@example.com', 'correct horse');
	const caller: McpCaller = {
		userId: user.id,
		tokenId: crypto.randomUUID(),
		label: 'Client',
		access
	};

	const client = new Client(
		{ name: 'protocol-test', version: '1.0.0' },
		{ versionNegotiation: { mode } }
	);
	await client.connect(
		new StreamableHTTPClientTransport(new URL('http://torsel.test/api/mcp'), {
			fetch: (input, init) => serveMcp(db, caller, new Request(input, init), '1.2.3')
		})
	);
	return client;
}

const MODES: [string, Mode, string][] = [
	['a 2025 client', 'legacy', '2025-11-25'],
	['a client that negotiates', 'auto', '2026-07-28'],
	['a client pinned to 2026-07-28', { pin: '2026-07-28' }, '2026-07-28']
];

describe.each(MODES)('the official client, as %s', (_, mode, version) => {
	it('connects at the revision it asks for, and reads the instructions', async () => {
		const client = await connect(mode);

		expect(client.getNegotiatedProtocolVersion()).toBe(version);
		expect(client.getServerVersion()).toMatchObject({ name: 'torsel', version: '1.2.3' });
		expect(client.getInstructions()).toMatch(/^Torsel holds a person's data/u);
		expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: false });
		await client.close();
	});

	it('writes, reads back as structured content, and refuses in one shape', async () => {
		const client = await connect(mode);

		const made = await client.callTool({
			name: 'create_table',
			arguments: { name: 'Sets', fields: [{ name: 'Weight', type: 'number' }] }
		});
		expect(made.isError).toBeFalsy();
		const { base } = made.structuredContent as { base: string };
		await client.callTool({
			name: 'add_rows',
			arguments: { base, table: 'Sets', rows: [{ Weight: 80 }, { Weight: 92.5 }] }
		});

		const read = await client.callTool({
			name: 'query',
			arguments: { base, sql: 'select max("Weight") as top from "Sets"' }
		});
		expect(read.structuredContent).toEqual({
			columns: ['top'],
			rows: [[92.5]],
			next: null,
			cut: 0
		});
		expect(JSON.parse((read.content as { text: string }[])[0].text)).toEqual(
			read.structuredContent
		);

		const refused = await client.callTool({
			name: 'add_rows',
			arguments: { base, table: 'Sets', rows: [{ Weight: 'heavy' }] }
		});
		expect(refused).toMatchObject({
			isError: true,
			content: [
				{ type: 'text', text: 'rows[0]."Weight": "heavy" is not a number; nothing was written' }
			]
		});
		expect(refused.structuredContent).toBeUndefined();

		const unknown = await client.callTool({ name: 'list_bases', arguments: { limit: 3 } });
		expect(unknown).toMatchObject({
			isError: true,
			content: [{ text: 'input takes no "limit"' }]
		});

		await expect(client.callTool({ name: 'drop_everything', arguments: {} })).rejects.toThrow(
			/drop_everything/u
		);
		await client.close();
	});

	it('shows a read-only token the reading tools alone', async () => {
		const client = await connect(mode, 'read');

		const { tools } = await client.listTools();

		expect(tools.map((tool) => tool.name)).toEqual(['list_bases', 'describe_base', 'query']);
		expect(client.getInstructions()).toMatch(/This token reads only/u);
		await expect(
			client.callTool({ name: 'create_base', arguments: { name: 'Nope' } })
		).rejects.toThrow(/create_base/u);
		await client.close();
	});
});

it('lists the same tools in every era', async () => {
	const lists = [];
	for (const [, mode] of MODES) {
		const client = await connect(mode);
		lists.push((await client.listTools()).tools);
		await client.close();
	}

	expect(lists[1]).toEqual(lists[0]);
	expect(lists[2]).toEqual(lists[0]);
	expect(lists[0]).toMatchSnapshot();
});

it('marks each tool for what it does to the data', async () => {
	const client = await connect('auto');

	const { tools } = await client.listTools();
	const hints = Object.fromEntries(
		tools.map((tool) => [
			tool.name,
			[
				tool.annotations?.readOnlyHint,
				tool.annotations?.destructiveHint,
				tool.annotations?.idempotentHint,
				tool.annotations?.openWorldHint
			]
		])
	);

	expect(hints).toEqual({
		list_bases: [true, false, true, false],
		describe_base: [true, false, true, false],
		query: [true, false, true, false],
		add_rows: [false, false, false, false],
		update_rows: [false, true, true, false],
		delete_rows: [false, true, true, false],
		create_base: [false, false, false, false],
		create_table: [false, false, false, false],
		add_field: [false, false, false, false],
		update_field: [false, true, true, false],
		create_view: [false, false, false, false],
		delete: [false, true, true, false],
		rename: [false, true, true, false],
		duplicate: [false, false, false, false],
		update_view: [false, true, true, false],
		move: [false, false, true, false],
		read_source: [true, false, true, true],
		connect_source: [false, false, false, true],
		refresh_source: [false, true, true, true],
		update_source: [false, true, true, true]
	});
	for (const tool of tools) {
		expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
		expect(tool.outputSchema?.type, tool.name).toBe('object');
	}
	await client.close();
});
