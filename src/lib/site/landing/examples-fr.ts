import type { Cell, Example } from './examples.ts';

const n = (value: Cell): number => Number(value);

export const EXAMPLES_FR: Example[] = [
	{
		id: 'budget',
		label: 'Budget',
		table: 'Budget',
		fields: [
			{ name: 'Poste', type: 'text' },
			{ name: 'Montant', type: 'number' },
			{
				name: 'Catégorie',
				type: 'choice',
				choices: [
					{ name: 'Maison', color: 'violet' },
					{ name: 'Courses', color: 'green' },
					{ name: 'Transport', color: 'blue' },
					{ name: 'Loisirs', color: 'pink' }
				]
			}
		],
		rows: [
			['Loyer', 640, 'Maison'],
			['Supermarché', 210, 'Courses'],
			['Train', 90, 'Transport'],
			['Marché', 120, 'Courses'],
			['Électricité', 110, 'Maison'],
			['Livres', 60, 'Loisirs']
		],
		prompts: [
			{
				text: 'Ajoute ce que chaque poste coûte par an.',
				kind: 'formula',
				name: 'Par an',
				expr: '"Montant" * 12',
				value: (row) => n(row[1]) * 12
			},
			{
				text: 'Ajoute Netflix 13 et escalade 45, en loisirs.',
				kind: 'rows',
				rows: [
					['Netflix', 13, 'Loisirs'],
					['Escalade', 45, 'Loisirs']
				]
			},
			{
				text: "Montre-moi où part l'argent.",
				kind: 'chart',
				name: 'Par catégorie',
				group: 2,
				value: 1,
				label: 'Total de montant'
			}
		]
	},
	{
		id: 'clients',
		label: 'Clients',
		table: 'Clients',
		fields: [
			{ name: 'Nom', type: 'text' },
			{
				name: 'Étape',
				type: 'choice',
				choices: [
					{ name: 'Piste', color: 'amber' },
					{ name: 'En discussion', color: 'blue' },
					{ name: 'Signé', color: 'green' },
					{ name: 'Perdu', color: 'gray' }
				]
			},
			{ name: 'Valeur', type: 'number' }
		],
		rows: [
			['Acme', 'Signé', 12000],
			['Bertin', 'En discussion', 4000],
			['Cèdre', 'Piste', 8000],
			['Delta', 'En discussion', 20000],
			['Fougère', 'Piste', 6000]
		],
		prompts: [
			{
				text: 'Ajoute la valeur attendue : signé compte en entier, en discussion la moitié, une piste un cinquième.',
				kind: 'formula',
				name: 'Attendu',
				expr: `"Valeur" * CASE "Étape" WHEN 'Signé' THEN 1 WHEN 'En discussion' THEN 0.5 WHEN 'Piste' THEN 0.2 ELSE 0 END`,
				value: (row) =>
					n(row[2]) * ({ Signé: 1, 'En discussion': 0.5, Piste: 0.2 }[String(row[1])] ?? 0)
			},
			{ text: 'Delta a signé.', kind: 'cell', row: 'Delta', field: 1, value: 'Signé' },
			{
				text: 'Fais un graphique du pipeline.',
				kind: 'chart',
				name: 'Pipeline',
				group: 1,
				value: 2,
				label: 'Total de valeur'
			}
		]
	},
	{
		id: 'trip',
		label: 'Voyage',
		table: 'Japon',
		fields: [
			{ name: 'Lieu', type: 'text' },
			{
				name: 'Type',
				type: 'choice',
				choices: [
					{ name: 'Hébergement', color: 'violet' },
					{ name: 'Train', color: 'blue' },
					{ name: 'Repas', color: 'green' },
					{ name: 'Visite', color: 'amber' }
				]
			},
			{ name: 'Coût', type: 'number' }
		],
		rows: [
			['Hôtel à Kyoto', 'Hébergement', 420],
			['Shinkansen', 'Train', 130],
			['Ramen', 'Repas', 40],
			['Fushimi', 'Visite', 20],
			['Ryokan', 'Hébergement', 280]
		],
		prompts: [
			{
				text: 'Ajoute la part de chacun si on partage à deux.',
				kind: 'formula',
				name: 'Chacun',
				expr: '"Coût" / 2.0',
				value: (row) => n(row[2]) / 2
			},
			{
				text: 'Ajoute des sushis à Osaka, 60.',
				kind: 'rows',
				rows: [['Sushis à Osaka', 'Repas', 60]]
			},
			{
				text: 'Fais un graphique du coût par type.',
				kind: 'chart',
				name: 'Par type',
				group: 1,
				value: 2,
				label: 'Total de coût'
			}
		]
	},
	{
		id: 'reading',
		label: 'Lecture',
		table: 'À lire',
		fields: [
			{ name: 'Titre', type: 'text' },
			{
				name: 'Statut',
				type: 'choice',
				choices: [
					{ name: 'À lire', color: 'gray' },
					{ name: 'En cours', color: 'amber' },
					{ name: 'Lu', color: 'green' }
				]
			},
			{ name: 'Pages', type: 'number' }
		],
		rows: [
			['Dune', 'Lu', 612],
			['Piranesi', 'En cours', 272],
			['Kindred', 'À lire', 264],
			['Solaris', 'Lu', 204],
			['Stoner', 'À lire', 278]
		],
		prompts: [
			{
				text: "Ajoute le nombre d'heures de lecture, à 40 pages par heure.",
				kind: 'formula',
				name: 'Heures',
				expr: '"Pages" / 40.0',
				value: (row) => n(row[2]) / 40
			},
			{ text: "J'ai fini Piranesi.", kind: 'cell', row: 'Piranesi', field: 1, value: 'Lu' },
			{
				text: 'Fais un graphique des pages par statut.',
				kind: 'chart',
				name: 'Par statut',
				group: 1,
				value: 2,
				label: 'Total de pages'
			}
		]
	}
];
