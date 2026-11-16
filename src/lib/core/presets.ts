import type { SourceWords } from '../i18n/sources.ts';
import type { Column, Every, Missing } from './source.ts';

export const PRESETS = ['letterboxd', 'sheet', 'github'] as const;

export type PresetId = (typeof PRESETS)[number];

/** A source filled in from one thing the person types; null fields come from the preview. */
export type PresetSource = {
	label: string;
	name: string;
	url: string;
	key: string | null;
	filter: string | null;
	every: Every;
	missing: Missing;
	columns: Column[] | null;
	// Asks for a key only when the person gives one.
	bearer: boolean;
};

const LETTERBOXD_USER =
	/^(?:(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/)?@?([A-Za-z0-9_]{1,40})\/?(?:rss\/?)?$/u;
const GITHUB_REPO =
	/^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/u;

/** A published Google Sheet's CSV, from any link to it: published, or shared from the editor. */
export function sheetCsv(link: string): string | null {
	let url: URL;
	try {
		url = new URL(link.trim());
	} catch {
		return null;
	}
	if (url.hostname !== 'docs.google.com') return null;
	const published = /^\/spreadsheets\/d\/e\/([\w-]+)\/pub(?:html)?$/u.exec(url.pathname);
	const gid = url.searchParams.get('gid') ?? /gid=(\d+)/u.exec(url.hash)?.[1] ?? null;
	if (published !== null) {
		const out = new URL(`https://docs.google.com/spreadsheets/d/e/${published[1]}/pub`);
		if (gid !== null) out.searchParams.set('gid', gid);
		out.searchParams.set('single', 'true');
		out.searchParams.set('output', 'csv');
		return out.href;
	}
	const edited = /^\/spreadsheets\/d\/([\w-]+)/u.exec(url.pathname);
	if (edited === null) return null;
	const out = new URL(`https://docs.google.com/spreadsheets/d/${edited[1]}/export`);
	out.searchParams.set('format', 'csv');
	if (gid !== null) out.searchParams.set('gid', gid);
	return out.href;
}

/** The source a preset makes of what the person typed, or null when it can't read it. */
export function presetSource(id: PresetId, value: string, words: SourceWords): PresetSource | null {
	const typed = value.trim();
	if (id === 'letterboxd') {
		const user = LETTERBOXD_USER.exec(typed)?.[1];
		if (user === undefined) return null;
		const lb = words.letterboxd;
		return {
			label: words.brands.letterboxd,
			name: words.brands.letterboxd,
			url: `https://letterboxd.com/${user}/rss/`,
			key: 'guid',
			// The diary feed carries lists too; a watched film has a title.
			filter: 'letterboxd:filmTitle',
			every: 'hour',
			// The feed holds the latest entries only: older ones are history, not deletions.
			missing: 'keep',
			bearer: false,
			columns: [
				{ path: 'letterboxd:filmTitle', name: lb.title, type: 'text' },
				{
					path: 'letterboxd:filmYear',
					name: lb.year,
					type: 'number',
					decimals: 0,
					grouping: false
				},
				{ path: 'letterboxd:watchedDate', name: lb.watched, type: 'date' },
				{
					path: 'letterboxd:memberRating',
					name: lb.rating,
					type: 'rating',
					min: 1,
					max: 5,
					step: 0.5
				},
				{ path: 'letterboxd:memberLike', name: lb.favorite, type: 'check' },
				{ path: 'letterboxd:rewatch', name: lb.rewatch, type: 'check' },
				{ path: 'link', name: lb.link, type: 'url' }
			]
		};
	}
	if (id === 'sheet') {
		const url = sheetCsv(typed);
		if (url === null) return null;
		return {
			label: words.brands.sheet,
			name: words.brands.sheet,
			url,
			key: null,
			filter: null,
			every: 'hour',
			missing: 'remove',
			bearer: false,
			columns: null
		};
	}
	const repo = GITHUB_REPO.exec(typed);
	if (repo === null) return null;
	const [, owner, name] = repo;
	const gh = words.github;
	return {
		label: words.brands.github,
		name: words.issues(`${owner}/${name}`),
		url: `https://api.github.com/repos/${owner}/${name}/issues?state=all&per_page=100`,
		key: 'id',
		filter: null,
		every: 'hour',
		missing: 'remove',
		bearer: true,
		columns: [
			{ path: 'number', name: gh.number, type: 'number', decimals: 0, grouping: false },
			{ path: 'title', name: gh.title, type: 'text' },
			{ path: 'state', name: gh.state, type: 'choice', choices: ['open', 'closed'] },
			{ path: 'user.login', name: gh.author, type: 'text' },
			{ path: 'created_at', name: gh.opened, type: 'datetime' },
			{ path: 'closed_at', name: gh.closed, type: 'datetime' },
			{ path: 'html_url', name: gh.link, type: 'url' }
		]
	};
}
