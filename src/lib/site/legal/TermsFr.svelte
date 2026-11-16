<script lang="ts">
	import { CONTACT, LEGAL_NAME, LEGAL_REGISTRATION, REPOSITORY } from '../site.ts';
	import LegalSection from './LegalSection.svelte';

	const link = 'text-ink underline underline-offset-2';
</script>

<p class="max-w-prose text-lg text-ink-2">
	Ces conditions couvrent le service de torsel.ilyasturki.com. Le code est une autre affaire : il
	est
	<a class={link} href={REPOSITORY}>open source sous licence MIT</a>, et tu peux faire tourner ton
	propre serveur sous cette seule licence.
</p>

<LegalSection title="Le service">
	<p>
		Torsel est gratuit. Tu peux utiliser l’app sans compte, et tes données restent alors sur ton
		appareil. Un compte ajoute la synchronisation entre tes appareils et l’assistant.
	</p>
</LegalSection>

<LegalSection title="Tes données">
	<p>
		Ce que tu saisis t’appartient. Faire tourner le service, c’est le stocker, le synchroniser et
		l’envoyer aux prestataires listés sur la page
		<a class={link} href="/fr/privacy">confidentialité</a> quand tu utilises les fonctions qui en ont
		besoin. Torsel ne prend aucun autre droit dessus.
	</p>
	<p>
		Garde ta propre copie de ce qui compte pour toi. Les Réglages exportent en JSON toutes les
		données de ton appareil.
	</p>
</LegalSection>

<LegalSection title="Usage loyal">
	<p>
		Garde ton mot de passe et tes jetons pour toi. N’utilise pas le service pour enfreindre la loi,
		l’attaquer ou contourner ses limites. Un compte qui le fait peut être suspendu.
	</p>
</LegalSection>

<LegalSection title="L’assistant">
	<p>
		L’assistant peut se tromper. Chaque changement qu’il fait s’applique tout de suite et peut être
		annulé. Vérifie ce qu’il fait avant de t’y fier.
	</p>
</LegalSection>

<LegalSection title="Sans garantie">
	<p>
		Le service est fourni tel quel, sans promesse de disponibilité, et il peut changer ou s’arrêter.
		S’il doit s’arrêter, les titulaires d’un compte sont prévenus par e-mail avec le temps
		d’exporter. Dans les limites permises par la loi, {LEGAL_NAME} n’est pas responsable des données perdues
		ni des dommages indirects. Tes droits de consommateur restent entiers.
	</p>
</LegalSection>

<LegalSection title="Qui édite Torsel">
	<p>
		{LEGAL_NAME}, {LEGAL_REGISTRATION}, France. Directeur de la publication : Ilyas Turki. Contact :
		<a class={link} href="mailto:{CONTACT}">{CONTACT}</a>.
	</p>
	<p>
		Hébergeur : Hetzner Online GmbH, Industriestraße 25, 91710 Gunzenhausen, Allemagne,
		<a class={link} href="https://www.hetzner.com">hetzner.com</a>.
	</p>
	<p>Ces conditions sont régies par le droit français.</p>
</LegalSection>
