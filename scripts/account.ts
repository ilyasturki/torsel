import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import {
	createUser,
	deleteUser,
	emailProblem,
	findUserByEmail,
	listUsers,
	revokeOtherTokens,
	setPassword
} from '../src/lib/server/auth/accounts.ts';
import { passwordProblem } from '../src/lib/server/auth/password.ts';
import { getDatabase } from '../src/lib/server/db/client.ts';
import { databasePath } from '../src/lib/server/db/config.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function usage(): never {
	fail(
		[
			'usage:',
			'  account create <email>            create an account, prompting for a password',
			'  account list                      list accounts',
			'  account password <email>          set a new password, revoking every credential',
			'  account delete <email> [--yes]    delete an account and every credential it owns',
			'',
			'  --yes           confirm a delete with no terminal to ask at, for a script',
			'  --keep-tokens   leave the credentials alone on a password change, for a plain',
			'                  rotation rather than a compromise'
		].join('\n')
	);
}

async function promptHidden(question: string): Promise<string> {
	/* oxlint-disable promise/prefer-await-to-callbacks */
	const discard = new Writable({
		write(_chunk, _encoding, callback): void {
			callback();
		}
	});
	/* oxlint-enable promise/prefer-await-to-callbacks */

	process.stdout.write(question);
	const rl = createInterface({ input: process.stdin, output: discard, terminal: true });

	try {
		return await rl.question('');
	} finally {
		rl.close();
		process.stdout.write('\n');
	}
}

async function readPassword(): Promise<string> {
	if (!process.stdin.isTTY) {
		return readFileSync(0, 'utf8').replace(/\r?\n$/u, '');
	}

	const password = await promptHidden('password: ');
	const again = await promptHidden('confirm:  ');

	if (password !== again) {
		fail('passwords do not match');
	}

	return password;
}

const db = getDatabase();

runMigrations(db);

const argv = process.argv.slice(2);
const assumeYes = argv.includes('--yes');
const keepTokens = argv.includes('--keep-tokens');
const [command, argument] = argv.filter((value) => !value.startsWith('--'));

if (command === 'create') {
	if (argument === undefined) {
		usage();
	}

	const problem = emailProblem(argument);
	if (problem !== undefined) {
		fail(problem);
	}
	if (findUserByEmail(db, argument) !== undefined) {
		fail(`${argument} already has an account`);
	}

	const password = await readPassword();
	const passwordIssue = passwordProblem(password);
	if (passwordIssue !== undefined) {
		fail(passwordIssue);
	}

	const user = await createUser(db, argument, password);
	console.log(`created ${user.email} (${user.id}) in ${databasePath}`);
} else if (command === 'list') {
	const users = listUsers(db);

	if (users.length === 0) {
		console.log(`no accounts in ${databasePath}`);
	} else {
		for (const user of users) {
			console.log(`${user.email}  ${user.id}  created ${user.createdAt.toISOString()}`);
		}
	}
} else if (command === 'password') {
	if (argument === undefined) {
		usage();
	}

	const user = findUserByEmail(db, argument);
	if (user === undefined) {
		fail(`no account for ${argument}`);
	}

	const password = await readPassword();
	const passwordIssue = passwordProblem(password);
	if (passwordIssue !== undefined) {
		fail(passwordIssue);
	}

	await setPassword(db, user.id, password);

	if (keepTokens) {
		console.log(`set a new password for ${user.email}; its credentials are untouched`);
	} else {
		const revoked = revokeOtherTokens(db, user.id, null);
		console.log(`set a new password for ${user.email} and revoked ${revoked} credential(s)`);
		console.log('every browser, phone and API token has to sign in again.');
	}
} else if (command === 'delete') {
	if (argument === undefined) {
		usage();
	}

	const user = findUserByEmail(db, argument);
	if (user === undefined) {
		fail(`no account for ${argument}`);
	}

	if (process.stdin.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const confirmation = await rl.question(`retype ${user.email} to confirm deletion: `);
		rl.close();

		if (confirmation.trim().toLowerCase() !== user.email) {
			fail('not confirmed, nothing deleted');
		}
	} else if (!assumeYes) {
		fail(`refusing to delete ${user.email} with no terminal to confirm at; pass --yes to mean it`);
	}

	deleteUser(db, user.email);
	console.log(`deleted ${user.email} and every credential it owned`);
} else {
	usage();
}
