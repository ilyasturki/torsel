<script lang="ts">
	import { CONTACT, LEGAL_NAME } from '../site.ts';
	import LegalSection from './LegalSection.svelte';

	const link = 'text-ink underline underline-offset-2';
</script>

<p class="max-w-prose text-lg text-ink-2">
	This page covers torsel.ilyasturki.com, run by {LEGAL_NAME}. A server you host yourself is yours
	to run, and this page does not apply to it.
</p>

<LegalSection title="With no account">
	<p>
		The app runs in your browser. Your tables live in this browser's storage and nothing you enter
		is sent to a server. The Android app works the same way until you connect it to one.
	</p>
	<p>
		The browser also keeps the app's own files, so it opens with no connection. Those files hold
		none of your data.
	</p>
	<p>
		Clearing the browser's site data deletes those tables, so export them from Settings if you want
		a copy.
	</p>
</LegalSection>

<LegalSection title="With an account">
	<p>
		An account adds sync and the assistant. The server stores your email address, a hash of your
		password if you set one, and the session tokens of your devices. Your tables, fields, views and
		rows are copied to the server so your devices can sync.
	</p>
	<p>
		This data runs the service and nothing else. It is not sold, and it is not used for advertising.
	</p>
</LegalSection>

<LegalSection title="The assistant">
	<p>
		The assistant runs when you open it or ask it something. Your messages, and the table data it
		reads to answer you or to suggest a request when you open it on a table, are sent to Anthropic,
		which runs the model. When a request needs the web, it searches through Anthropic's web search,
		which receives the search words. Under
		<a class={link} href="https://www.anthropic.com/legal/commercial-terms">
			Anthropic's commercial terms
		</a>
		that content is not used to train its models. If you never open the assistant, nothing goes to Anthropic.
	</p>
</LegalSection>

<LegalSection title="Email and Google">
	<p>
		Sign-in links and codes are sent through Brevo, which receives your email address and the
		message.
	</p>
	<p>
		If you choose to sign in with Google, Google tells Torsel your email address and that it is
		verified. Torsel never needs a Google account.
	</p>
</LegalSection>

<LegalSection title="MCP clients">
	<p>
		A token you create in Settings lets the MCP client you give it to read your data, or read and
		change it, as you chose. An app you connect by signing in to Torsel, such as Claude or ChatGPT,
		gets access only once you allow it on Torsel’s consent screen, which can limit it to reading.
		What a client does with the data is between you and whoever makes it. You can revoke a token or
		a connected app in Settings at any time.
	</p>
</LegalSection>

<LegalSection title="Linked tables">
	<p>
		When you link a table to a web address, Torsel’s server fetches it for you, when you ask and on
		the schedule you choose. The site you link sees Torsel’s server, never your device. A key you
		give for that address is stored encrypted on the server and used for that address alone. It is
		never shown again, and it is deleted when you stop syncing the table or delete your account.
	</p>
</LegalSection>

<LegalSection title="Cookies and tracking">
	<p>
		There is one cookie, <code class="font-mono text-sm">torsel_session</code>, set when you sign in
		and used to keep you signed in. Torsel has no analytics, no ads and no third-party scripts.
	</p>
</LegalSection>

<LegalSection title="Hosting and logs">
	<p>
		The server runs at Hetzner in Germany. The reverse proxy writes no access logs. The app logs
		errors for diagnosis, and it counts failed sign-ins by IP address in memory to slow down
		password guessing.
	</p>
</LegalSection>

<LegalSection title="Your rights">
	<p>
		You can ask to access, correct, delete or receive your data, or object to how it is used.
		Settings exports everything on your device as JSON. To delete your account and the server's copy
		of your data, write to <a class={link} href="mailto:{CONTACT}">{CONTACT}</a>.
	</p>
	<p>
		Personal data is processed to provide the service you asked for. You can also complain to the
		<a class={link} href="https://www.cnil.fr/en">CNIL</a>, the French data protection authority.
	</p>
</LegalSection>
