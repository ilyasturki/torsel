import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	lang: (segment: string): 'fr' | undefined => (segment === 'fr' ? 'fr' : undefined)
});
