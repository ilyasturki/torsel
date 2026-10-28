import node from '@sveltejs/adapter-node';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import pkg from './package.json' with { type: 'json' };

const isAppBuild = process.env.BUILD_TARGET === 'app';

const adapter = isAppBuild
	? staticAdapter({ pages: 'build/app', assets: 'build/app', fallback: 'index.html' })
	: node({ out: 'build/server' });

export default defineConfig({
	define: {
		'import.meta.env.APP_BUILD': JSON.stringify(isAppBuild),
		'import.meta.env.DEFAULT_SERVER': JSON.stringify(
			process.env.DEFAULT_SERVER ?? 'https://torsel.ilyasturki.com'
		),
		'import.meta.env.APP_VERSION': JSON.stringify(pkg.version)
	},
	optimizeDeps: {
		exclude: ['@sqlite.org/sqlite-wasm']
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/u).includes('node_modules') ? undefined : true
			},
			adapter
		})
	]
});
