import type { LookupAddress } from 'node:dns';
import { lookup as resolve } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { fetchesPrivate } from '../config.ts';

export type Refusal = 'scheme' | 'address' | 'size' | 'timeout' | 'network';

/** A fetch the guard stopped, or one that failed on the way. */
export class FetchRefused extends Error {
	constructor(
		readonly reason: Refusal,
		detail: string
	) {
		super(detail);
		this.name = 'FetchRefused';
	}
}

export type GuardedRequest = {
	accept: string;
	timeoutMs: number;
	maxBytes: number;
	/** 0 hands a redirect back as the answer. */
	maxRedirects: number;
	headers?: Record<string, string>;
	/** Lets loopback and private addresses through: a LAN-only server, or the e2e suite's fixtures. */
	allowPrivate?: boolean;
};

export type Fetched = {
	url: string;
	status: number;
	headers: Record<string, string>;
	body: Buffer;
};

const DENIED: [string, number, 'ipv4' | 'ipv6'][] = [
	['0.0.0.0', 8, 'ipv4'],
	['10.0.0.0', 8, 'ipv4'],
	['100.64.0.0', 10, 'ipv4'],
	['127.0.0.0', 8, 'ipv4'],
	['169.254.0.0', 16, 'ipv4'],
	['172.16.0.0', 12, 'ipv4'],
	['192.0.0.0', 24, 'ipv4'],
	['192.0.2.0', 24, 'ipv4'],
	['192.168.0.0', 16, 'ipv4'],
	['198.18.0.0', 15, 'ipv4'],
	['198.51.100.0', 24, 'ipv4'],
	['203.0.113.0', 24, 'ipv4'],
	['224.0.0.0', 4, 'ipv4'],
	['240.0.0.0', 4, 'ipv4'],
	['::', 128, 'ipv6'],
	['::1', 128, 'ipv6'],
	['64:ff9b::', 96, 'ipv6'],
	['64:ff9b:1::', 48, 'ipv6'],
	['2001:db8::', 32, 'ipv6'],
	['fc00::', 7, 'ipv6'],
	['fe80::', 10, 'ipv6'],
	['ff00::', 8, 'ipv6']
];

let denied: BlockList | undefined;
let interfacesFailureLogged = false;

function hostInterfaces(): ReturnType<typeof networkInterfaces> {
	try {
		return networkInterfaces();
	} catch (error) {
		if (!interfacesFailureLogged) {
			interfacesFailureLogged = true;
			console.error("fetch guard: the host's addresses are unreadable, refusing fetches:", error);
		}
		throw new FetchRefused('network', "the host's own addresses are unreadable");
	}
}

// Built on first use: the host's own public addresses reach the other apps it serves.
function denyList(): BlockList {
	if (denied !== undefined) {
		return denied;
	}
	const host = hostInterfaces();
	const list = new BlockList();
	for (const [address, prefix, family] of DENIED) {
		list.addSubnet(address, prefix, family);
	}
	for (const entries of Object.values(host)) {
		for (const entry of entries ?? []) {
			list.addAddress(entry.address, entry.family === 'IPv6' ? 'ipv6' : 'ipv4');
		}
	}
	denied = list;
	return denied;
}

/** Whether an address is off limits; IPv4-mapped IPv6 forms count as their IPv4 address. Throws a FetchRefused when the host's addresses are unreadable. */
export function deniedAddress(address: string): boolean {
	const bare = address.replace(/^\[|\]$/gu, '');
	const family = isIP(bare);
	if (family === 0) {
		return true;
	}
	return denyList().check(bare, family === 6 ? 'ipv6' : 'ipv4');
}

function screened(
	hostname: string,
	list: LookupAddress[],
	allowPrivate: boolean
): FetchRefused | undefined {
	try {
		if (
			list.length === 0 ||
			(!allowPrivate && list.some(({ address }) => deniedAddress(address)))
		) {
			return new FetchRefused('address', `${hostname} resolves to a private address`);
		}
	} catch (error) {
		return refusal(error);
	}
	return undefined;
}

// The socket connects to the address this returns, so the address checked is the one used.
// A throw out of the dns callback is uncaught and ends the process: every failure goes to `callback`.
function guardedLookup(allowPrivate: boolean): LookupFunction {
	return (hostname, options, callback) => {
		resolve(hostname, { all: true, family: options.family }, (error, addresses) => {
			if (error !== null) {
				callback(error, '', 0);
				return;
			}
			const list = addresses as LookupAddress[];
			const refused = screened(hostname, list, allowPrivate);
			if (refused !== undefined) {
				callback(refused, '', 0);
				return;
			}
			if (options.all === true) {
				(callback as unknown as (error: null, all: LookupAddress[]) => void)(null, list);
			} else {
				callback(null, list[0].address, list[0].family);
			}
		});
	};
}

function checkTarget(url: URL, allowPrivate: boolean): void {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new FetchRefused('scheme', `${url.protocol} is not fetched`);
	}
	if (url.username !== '' || url.password !== '') {
		throw new FetchRefused('scheme', 'credentials in a URL are not fetched');
	}
	// Node skips `lookup` for an address literal: check it here.
	const literal = url.hostname.replace(/^\[|\]$/gu, '');
	if (isIP(literal) !== 0 && !allowPrivate && deniedAddress(literal)) {
		throw new FetchRefused('address', `${url.hostname} is a private address`);
	}
}

function decoded(response: IncomingMessage): Readable {
	switch ((response.headers['content-encoding'] ?? '').trim().toLowerCase()) {
		case 'gzip':
		case 'x-gzip':
			return response.pipe(createGunzip());
		case 'deflate':
			return response.pipe(createInflate());
		case 'br':
			return response.pipe(createBrotliDecompress());
		default:
			return response;
	}
}

function flatHeaders(response: IncomingMessage): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(response.headers)) {
		if (value !== undefined) {
			headers[name] = Array.isArray(value) ? value.join(', ') : value;
		}
	}
	return headers;
}

function once(
	url: URL,
	options: GuardedRequest,
	allowPrivate: boolean,
	signal: AbortSignal
): Promise<Fetched> {
	checkTarget(url, allowPrivate);
	const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

	return new Promise((settle, fail) => {
		const request = send(
			url,
			{
				method: 'GET',
				headers: { 'user-agent': 'Torsel', accept: options.accept, ...options.headers },
				lookup: guardedLookup(allowPrivate),
				signal
			},
			(response) => {
				const chunks: Buffer[] = [];
				let size = 0;
				const body = decoded(response);
				let over = false;
				body.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > options.maxBytes && !over) {
						over = true;
						fail(new FetchRefused('size', `the answer runs past ${options.maxBytes} bytes`));
						request.destroy();
						return;
					}
					chunks.push(chunk);
				});
				body.on(
					'end',
					() =>
						over ||
						settle({
							url: url.href,
							status: response.statusCode ?? 0,
							headers: flatHeaders(response),
							body: Buffer.concat(chunks)
						})
				);
				body.on('error', (error) => fail(refusal(error)));
			}
		);
		request.on('error', (error) => fail(refusal(error)));
		request.end();
	});
}

function refusal(error: unknown): FetchRefused {
	if (error instanceof FetchRefused) {
		return error;
	}
	if (error instanceof Error && error.name === 'AbortError') {
		return new FetchRefused('timeout', 'the fetch ran out of time');
	}
	return new FetchRefused('network', error instanceof Error ? error.message : String(error));
}

/** GET a URL anyone could have chosen: http(s) only, no private address even after a redirect, within budget. */
export async function guardedFetch(
	target: string | URL,
	options: GuardedRequest
): Promise<Fetched> {
	const allowPrivate = options.allowPrivate ?? fetchesPrivate();
	const signal = AbortSignal.timeout(options.timeoutMs);
	let url = new URL(target);
	let headers = options.headers;

	for (let hop = 0; ; hop += 1) {
		let answer: Fetched;
		try {
			answer = await once(url, { ...options, headers }, allowPrivate, signal);
		} catch (error) {
			throw refusal(error);
		}
		const location = answer.headers.location;
		if (answer.status < 300 || answer.status >= 400 || location === undefined) {
			return answer;
		}
		if (hop >= options.maxRedirects) {
			return answer;
		}
		const next = new URL(location, url);
		if (next.origin !== url.origin && headers !== undefined) {
			headers = Object.fromEntries(
				Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization')
			);
		}
		url = next;
	}
}
