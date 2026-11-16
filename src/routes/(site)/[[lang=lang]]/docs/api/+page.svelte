<script lang="ts">
	import { page } from '$app/state';

	import { site as t } from '#lib/i18n/site.ts';
	import { entries, shape } from '#lib/site/api-doc.ts';
	import Seo from '#lib/site/Seo.svelte';

	let { data } = $props();

	const locale = $derived(page.params.lang ?? 'en');
	const operations = $derived(entries(data.doc));
	const server = $derived(data.doc.servers[0]?.url ?? '');
	const schemas = $derived(Object.entries(data.doc.components.schemas));

	const code = 'rounded-box bg-tint p-3 font-mono text-sm whitespace-pre overflow-x-auto';
	const label = 'text-sm font-semibold text-ink-2';
</script>

<Seo title={t.api} description={t.apiDescription} path="/docs/api" {locale} />

<article class="flex gap-12 rounded-panel bg-raised p-5 shadow-raised lg:px-16 lg:py-14">
	<nav class="sticky top-6 hidden w-56 shrink-0 self-start lg:block" aria-label={t.apiOperations}>
		<ul class="flex flex-col">
			{#each operations as { method, operation } (operation.operationId)}
				<li>
					<a
						class="flex min-h-row items-center gap-2 text-ink-2 transition-colors motion hover:text-ink"
						href="#{operation.operationId}"
					>
						<span class="w-12 shrink-0 font-mono text-xs text-ink-3">{method}</span>
						<span class="truncate">{operation.summary}</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="flex min-w-0 flex-1 flex-col gap-12">
		<header class="flex max-w-prose flex-col gap-4">
			<h1 class="text-2xl leading-none font-semibold tighter lg:text-hero">{t.api}</h1>
			<code class="font-mono text-sm break-all">{server}</code>
			<p>{t.apiAuth}</p>
			<code class="-mt-2 font-mono text-sm">Authorization: Bearer &lt;token&gt;</code>
			<p class="text-ink-2">{t.apiNames}</p>
			<a class="self-start font-medium underline" href="/api/v1/openapi.json">{t.apiSpec}</a>
		</header>

		{#each operations as { method, path, operation } (operation.operationId)}
			{@const writes = operation.security.some((scheme) => scheme.oauth?.includes('write'))}
			{@const success = Object.entries(operation.responses).find(([status]) =>
				status.startsWith('2')
			)}
			<section id={operation.operationId} class="flex scroll-mt-6 flex-col gap-3">
				<h2 class="text-lg font-semibold">{operation.summary}</h2>
				<p class="font-mono text-sm break-all">
					<span class="font-semibold">{method}</span>
					<span class="text-ink-2">{path}</span>
				</p>
				{#if writes}<p class="text-sm text-ink-3">{t.apiWrite}</p>{/if}
				{#if operation.description}
					<p class="max-w-prose text-ink-2">{operation.description}</p>
				{/if}
				{#if operation.parameters?.length}
					<h3 class={label}>{t.apiParameters}</h3>
					<dl class="flex flex-col gap-2">
						{#each operation.parameters as parameter (parameter.name)}
							<div class="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
								<dt class="font-mono text-sm sm:w-40 sm:shrink-0">
									{parameter.name}
									<span class="text-ink-3">{shape(parameter.schema)}</span>
								</dt>
								<dd class="text-sm text-ink-2">
									{#if parameter.required}<span class="text-ink">{t.apiRequired}</span>{/if}
									{parameter.description ?? ''}
								</dd>
							</div>
						{/each}
					</dl>
				{/if}
				{#if operation.requestBody}
					<h3 class={label}>{t.apiBody}</h3>
					<pre class={code}>{shape(operation.requestBody.content['application/json'].schema)}</pre>
				{/if}
				{#if success}
					<h3 class={label}>{t.apiAnswer} {success[0]}</h3>
					<pre class={code}>{shape(success[1].content['application/json'].schema)}</pre>
				{/if}
			</section>
		{/each}

		{#each schemas as [name, schema] (name)}
			<section id={name} class="flex scroll-mt-6 flex-col gap-3">
				<h2 class="font-mono text-lg font-semibold">{name}</h2>
				<pre class={code}>{shape(schema)}</pre>
				{#each Object.entries(schema.properties ?? {}) as [key, property] (key)}
					{@const inner =
						typeof property.additionalProperties === 'object'
							? property.additionalProperties
							: property}
					{#if inner.description}
						<p class="max-w-prose text-sm text-ink-2">
							<code class="font-mono">{key}</code>
							{inner.description}
						</p>
					{/if}
				{/each}
			</section>
		{/each}
	</div>
</article>
