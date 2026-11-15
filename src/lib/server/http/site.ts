import type { Handle } from '@sveltejs/kit/hooks';

/** A site page under `/fr` names its language in `<html lang>`. */
export const handleSite: Handle = async ({ event, resolve }) => {
	if (event.route.id?.startsWith('/(site)') !== true || event.params.lang === undefined) {
		return resolve(event);
	}
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('<html lang="en">', '<html lang="fr">')
	});
};
