import { MediaQuery } from 'svelte/reactivity';

/** Tailwind's `sm`: from here up a menu hangs from its button and a form is a centred dialog. */
export const wide = new MediaQuery('min-width: 40rem', true);

/** Tailwind's `lg`: from here up Entry's form sits beside what it logs. */
export const roomy = new MediaQuery('min-width: 64rem', true);
