import { MediaQuery } from 'svelte/reactivity';

/** Tailwind's `sm`: from here up a menu hangs from its button and a form is a centred dialog. */
export const wide = new MediaQuery('min-width: 40rem', true);
