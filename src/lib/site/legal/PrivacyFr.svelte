<script lang="ts">
	import { CONTACT, LEGAL_NAME } from '../site.ts';
	import LegalSection from './LegalSection.svelte';

	const link = 'text-ink underline underline-offset-2';
</script>

<p class="max-w-prose text-lg text-ink-2">
	Cette page concerne torsel.ilyasturki.com, exploité par {LEGAL_NAME}. Un serveur que tu héberges
	toi-même relève de toi, et cette page ne s’y applique pas.
</p>

<LegalSection title="Sans compte">
	<p>
		L’app tourne dans ton navigateur. Tes tables sont stockées dans ce navigateur et rien de ce que
		tu saisis n’est envoyé à un serveur. L’app Android fonctionne de la même façon tant que tu ne la
		connectes pas à un serveur.
	</p>
	<p>
		Le navigateur garde aussi les fichiers de l’app, pour qu’elle s’ouvre sans connexion. Ces
		fichiers ne contiennent aucune de tes données.
	</p>
	<p>
		Effacer les données du site dans le navigateur supprime ces tables : exporte-les depuis les
		Réglages si tu veux en garder une copie.
	</p>
</LegalSection>

<LegalSection title="Avec un compte">
	<p>
		Un compte ajoute la synchronisation et l’assistant. Le serveur stocke ton adresse e-mail, une
		empreinte de ton mot de passe si tu en as défini un et les jetons de session de tes appareils.
		Tes tables, champs, vues et lignes sont copiés sur le serveur pour que tes appareils se
		synchronisent.
	</p>
	<p>
		Ces données servent à faire tourner le service et à rien d’autre. Elles ne sont ni vendues ni
		utilisées pour de la publicité.
	</p>
</LegalSection>

<LegalSection title="L’assistant">
	<p>
		L’assistant ne s’exécute que quand tu lui demandes quelque chose. Tes messages et les données de
		table qu’il lit pour te répondre sont envoyés à Anthropic, qui fait tourner le modèle. Selon les
		<a class={link} href="https://www.anthropic.com/legal/commercial-terms">
			conditions commerciales d’Anthropic</a
		>, ce contenu ne sert pas à entraîner ses modèles. Si tu n’ouvres jamais l’assistant, rien ne
		part chez Anthropic.
	</p>
</LegalSection>

<LegalSection title="E-mail et Google">
	<p>
		Les liens et codes de connexion passent par Brevo, qui reçoit ton adresse e-mail et le message.
	</p>
	<p>
		Si tu choisis de te connecter avec Google, Google transmet à Torsel ton adresse e-mail et le
		fait qu’elle est vérifiée. Torsel n’exige jamais de compte Google.
	</p>
</LegalSection>

<LegalSection title="Clients MCP">
	<p>
		Avec un jeton créé dans les Réglages, le client MCP à qui tu le donnes peut lire tes données, ou
		les lire et les modifier, selon ton choix. Une app que tu relies en te connectant à Torsel,
		comme Claude ou ChatGPT, n’y accède qu’une fois que tu l’as autorisée sur l’écran d’autorisation
		de Torsel, qui peut limiter cet accès à la lecture. Ce qu’un client fait de tes données se règle
		entre toi et son éditeur. Tu peux révoquer un jeton ou une app connectée dans les Réglages à
		tout moment.
	</p>
</LegalSection>

<LegalSection title="Cookies et suivi">
	<p>
		Il y a un seul cookie, <code class="font-mono text-sm">torsel_session</code>, posé à la
		connexion pour que ta session reste ouverte. Torsel n’a ni mesure d’audience, ni publicité, ni
		script tiers.
	</p>
</LegalSection>

<LegalSection title="Hébergement et journaux">
	<p>
		Le serveur est hébergé chez Hetzner, en Allemagne. Le proxy inverse n’écrit aucun journal
		d’accès. L’app journalise les erreurs pour les diagnostiquer et compte en mémoire les connexions
		échouées par adresse IP pour freiner les tentatives sur les mots de passe.
	</p>
</LegalSection>

<LegalSection title="Tes droits">
	<p>
		Tu peux demander à accéder à tes données, à les corriger, à les supprimer ou à les récupérer, ou
		t’opposer à leur traitement. Les Réglages exportent en JSON tout ce qui se trouve sur ton
		appareil. Pour supprimer ton compte et la copie de tes données sur le serveur, écris à
		<a class={link} href="mailto:{CONTACT}">{CONTACT}</a>.
	</p>
	<p>
		Les données personnelles sont traitées pour fournir le service que tu as demandé. Tu peux aussi
		saisir la <a class={link} href="https://www.cnil.fr">CNIL</a>.
	</p>
</LegalSection>
