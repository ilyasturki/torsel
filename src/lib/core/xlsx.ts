type Entry = { method: number; raw: Uint8Array };

const decoder = new TextDecoder();

/** The stored files of a zip by name, still compressed; null when it is no zip. */
export function zipEntries(data: Uint8Array): Map<string, Entry> | null {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const u16 = (at: number): number => view.getUint16(at, true);
	const u32 = (at: number): number => view.getUint32(at, true);
	const entries = new Map<string, Entry>();
	let end = -1;
	for (let at = data.length - 22; at >= Math.max(0, data.length - 65_557); at -= 1) {
		if (u32(at) === 0x06054b50) {
			end = at;
			break;
		}
	}
	if (end === -1) return null;
	const count = u16(end + 10);
	let at = u32(end + 16);
	for (let index = 0; index < count; index += 1) {
		if (at + 46 > data.length || u32(at) !== 0x02014b50) return null;
		const method = u16(at + 10);
		const compressed = u32(at + 20);
		const nameLength = u16(at + 28);
		const extraLength = u16(at + 30);
		const commentLength = u16(at + 32);
		const local = u32(at + 42);
		const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
		const start = local + 30 + u16(local + 26) + u16(local + 28);
		if (method === 0 || method === 8) {
			entries.set(name, { method, raw: data.subarray(start, start + compressed) });
		}
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

function unescapeXml(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, code: string) => {
		if (code[0] === '#') {
			return String.fromCodePoint(
				code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
			);
		}
		return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()] as string;
	});
}

function textsOf(xml: string): string {
	return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
		.map((match) => unescapeXml(match[1]))
		.join('');
}

function attribute(tag: string, name: string): string | undefined {
	return tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'u'))?.[1];
}

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Which cell styles show a number as a date, and whether with its time. */
function dateStyles(styles: string | undefined): Map<number, boolean> {
	const out = new Map<number, boolean>();
	if (styles === undefined) return out;
	const custom = new Map<number, string>();
	for (const match of styles.matchAll(/<numFmt\s[^>]*>/gu)) {
		const id = Number(attribute(match[0], 'numFmtId'));
		custom.set(id, unescapeXml(attribute(match[0], 'formatCode') ?? ''));
	}
	const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/u)?.[1] ?? '';
	[...xfs.matchAll(/<xf\s[^>]*>/gu)].forEach((match, index) => {
		const id = Number(attribute(match[0], 'numFmtId'));
		const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/gu, '').toLowerCase();
		const isDate = DATE_FORMATS.has(id) || (/[dy]/u.test(code) && !/^[#0.,%\s]*$/u.test(code));
		if (isDate) out.set(index, [18, 19, 20, 21, 22, 45, 46, 47].includes(id) || /h/u.test(code));
	});
	return out;
}

function excelDate(serial: number, timed: boolean): string {
	const ms = Math.round((serial - 25569) * 86_400_000);
	const iso = new Date(ms).toISOString();
	return timed && serial % 1 !== 0 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function columnIndex(ref: string): number {
	const letters = ref.match(/^[A-Z]+/u)?.[0] ?? 'A';
	let index = 0;
	for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
	return index - 1;
}

/** The first sheet's rows, padded to one width, from the workbook's files read as text. */
export function sheetRows(read: (name: string) => string | undefined): string[][] | null {
	const workbook = read('xl/workbook.xml');
	const rels = read('xl/_rels/workbook.xml.rels') ?? '';
	const first = workbook?.match(/<sheet\s[^>]*>/u)?.[0];
	const rid = first === undefined ? undefined : attribute(first, 'r:id');
	const target = [...rels.matchAll(/<Relationship\s[^>]*>/gu)]
		.map((match) => match[0])
		.find((tag) => attribute(tag, 'Id') === rid);
	const path = target === undefined ? 'worksheets/sheet1.xml' : (attribute(target, 'Target') ?? '');
	const sheet = read(path.startsWith('/') ? path.slice(1) : `xl/${path}`);
	if (sheet === undefined) return null;

	const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/gu)].map(
		(match) => textsOf(match[1])
	);
	const dates = dateStyles(read('xl/styles.xml'));

	const rows: string[][] = [];
	for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
		const cells: string[] = [];
		for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
			const tag = cell[1];
			const inner = cell[2] ?? '';
			const at = columnIndex(attribute(tag, 'r') ?? '');
			const type = attribute(tag, 't');
			const raw = inner.match(/<v>([\s\S]*?)<\/v>/u)?.[1];
			let value = '';
			if (type === 's') value = shared[Number(raw)] ?? '';
			else if (type === 'inlineStr') value = textsOf(inner);
			else if (type === 'b') value = raw === '1' ? 'true' : 'false';
			else if (raw !== undefined) {
				const style = Number(attribute(tag, 's') ?? -1);
				const number = Number(raw);
				value =
					type !== 'str' && dates.has(style) && Number.isFinite(number)
						? excelDate(number, dates.get(style) === true)
						: unescapeXml(raw);
			}
			while (cells.length < at) cells.push('');
			cells[at] = value;
		}
		if (cells.some((cell) => cell.trim() !== '')) rows.push(cells);
	}
	const width = Math.max(0, ...rows.map((cells) => cells.length));
	return rows.length === 0
		? null
		: rows.map((cells) => [...cells, ...Array<string>(width - cells.length).fill('')]);
}

async function inflated(raw: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([raw.slice()])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The workbook's first sheet, inflated with the platform's `DecompressionStream`; null when it is no workbook. */
export async function readXlsx(data: Uint8Array): Promise<string[][] | null> {
	const texts = new Map<string, string>();
	try {
		for (const [name, { method, raw }] of zipEntries(data) ?? []) {
			if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
			texts.set(name, decoder.decode(method === 0 ? raw : await inflated(raw)));
		}
	} catch {
		return null;
	}
	return sheetRows((name) => texts.get(name));
}
