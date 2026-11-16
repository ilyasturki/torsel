import type { NetworkInterfaceInfo } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Guard from './guard.ts';

const interfaces = vi.hoisted(() => ({
	read: (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({})
}));

vi.mock('node:os', async (actual) => ({
	...(await actual<typeof import('node:os')>()),
	networkInterfaces: () => interfaces.read()
}));

const BUDGET = { accept: '*/*', timeoutMs: 2000, maxBytes: 1000, maxRedirects: 0 };

const HOST_ADDRESS = '93.184.216.34';

function unreadable(): never {
	throw Object.assign(new Error('uv_interface_addresses returned Unknown system error 97'), {
		code: 'ERR_SYSTEM_ERROR'
	});
}

function readable(): NodeJS.Dict<NetworkInterfaceInfo[]> {
	return {
		eth0: [
			{
				address: HOST_ADDRESS,
				netmask: '255.255.255.0',
				family: 'IPv4',
				mac: '00:00:00:00:00:00',
				internal: false,
				cidr: `${HOST_ADDRESS}/24`
			}
		]
	};
}

async function refusal(guard: typeof Guard, promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof guard.FetchRefused) return `${error.reason}: ${error.message}`;
		throw error;
	}
	return 'fetched';
}

describe('the guard when the host addresses are unreadable', () => {
	let guard: typeof Guard;
	let uncaught: unknown[];
	const record = (error: unknown) => uncaught.push(error);

	beforeEach(async () => {
		vi.resetModules();
		guard = await import('./guard.ts');
		uncaught = [];
		process.on('uncaughtException', record);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		process.off('uncaughtException', record);
		vi.restoreAllMocks();
	});

	it('refuses the fetch, by name and by address, and the process lives', async () => {
		interfaces.read = unreadable;
		const refused = "network: the host's own addresses are unreadable";
		expect(await refusal(guard, guard.guardedFetch('http://localhost:9/', BUDGET))).toBe(refused);
		expect(await refusal(guard, guard.guardedFetch('http://8.8.8.8:9/', BUDGET))).toBe(refused);
		expect(uncaught).toEqual([]);
		expect(console.error).toHaveBeenCalledOnce();
	});

	it('keeps no partial list: once readable, it denies the host, loopback and private', async () => {
		interfaces.read = unreadable;
		expect(() => guard.deniedAddress('8.8.8.8')).toThrow(guard.FetchRefused);
		interfaces.read = readable;
		expect(guard.deniedAddress(HOST_ADDRESS)).toBe(true);
		expect(guard.deniedAddress('127.0.0.1')).toBe(true);
		expect(guard.deniedAddress('10.0.0.1')).toBe(true);
		expect(guard.deniedAddress('8.8.8.8')).toBe(false);
	});

	it('reads them at start without throwing, logs once, and denies once they read', async () => {
		interfaces.read = unreadable;
		expect(() => guard.loadDenyList()).not.toThrow();
		const refused = "network: the host's own addresses are unreadable";
		expect(await refusal(guard, guard.guardedFetch('http://8.8.8.8:9/', BUDGET))).toBe(refused);
		expect(console.error).toHaveBeenCalledOnce();
		interfaces.read = readable;
		expect(guard.deniedAddress(HOST_ADDRESS)).toBe(true);
	});
});

describe('the guard over time', () => {
	const GAINED = '198.252.206.16';

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		interfaces.read = readable;
	});

	it('denies an address the host gains, once the list is an hour old', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.resetModules();
		const guard = await import('./guard.ts');
		interfaces.read = readable;
		guard.loadDenyList();
		interfaces.read = () => ({
			...readable(),
			eth1: [{ ...(readable().eth0?.[0] as NetworkInterfaceInfo), address: GAINED }]
		});
		vi.advanceTimersByTime(59 * 60 * 1000);
		expect(guard.deniedAddress(GAINED)).toBe(false);
		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(guard.deniedAddress(GAINED)).toBe(true);
		expect(guard.deniedAddress(HOST_ADDRESS)).toBe(true);
	});

	it('refuses, rather than keep a stale list, when the hourly read fails', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.resetModules();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const guard = await import('./guard.ts');
		interfaces.read = readable;
		guard.loadDenyList();
		interfaces.read = unreadable;
		vi.advanceTimersByTime(61 * 60 * 1000);
		expect(() => guard.deniedAddress('8.8.8.8')).toThrow(guard.FetchRefused);
	});
});
