import { error } from '@sveltejs/kit';

// Unmatched routes get the root error page; this keeps a bad /app address inside the app's shell.
export function load(): never {
	error(404);
}
