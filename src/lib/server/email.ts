import { brevoKey, emailSender } from './config.ts';

export type Delivery = 'sent' | 'logged' | 'failed';

export type Mail = {
	to: string;
	subject: string;
	text: string;
	html: string;
	link?: string;
	code?: string;
};

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// tests/e2e/harness.ts reads the link and the code off this line.
function logged(mail: Mail, reason: string): Delivery {
	console.info(
		`[email] ${reason}: skipping "${mail.subject}" to ${mail.to}` +
			(mail.link === undefined ? '' : ` (link: ${mail.link})`) +
			(mail.code === undefined ? '' : ` (code: ${mail.code})`)
	);
	return 'logged';
}

export async function deliver(mail: Mail): Promise<Delivery> {
	const key = brevoKey();
	const sender = emailSender();

	if (key === undefined) {
		return logged(mail, 'BREVO_API_KEY not set');
	}
	if (sender === undefined) {
		return logged(mail, 'TORSEL_EMAIL_FROM not set');
	}

	try {
		const response = await fetch('https://api.brevo.com/v3/smtp/email', {
			method: 'POST',
			headers: { 'api-key': key, 'content-type': 'application/json' },
			body: JSON.stringify({
				sender,
				to: [{ email: mail.to }],
				subject: mail.subject,
				textContent: mail.text,
				htmlContent: mail.html
			}),
			signal: AbortSignal.timeout(15_000)
		});

		if (!response.ok) {
			console.error(`[email] "${mail.subject}" to ${mail.to}: Brevo said ${response.status}`);
			return 'failed';
		}

		return 'sent';
	} catch (error) {
		console.error(`[email] "${mail.subject}" to ${mail.to} failed:`, error);
		return 'failed';
	}
}

function frame(content: string): string {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin: 0; padding: 32px 16px; background: #f6f6f8; color: #17181c; font: 15px/1.5 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="max-width: 480px; margin: 0 auto; padding: 28px; background: #ffffff; border-radius: 3px;">
${content}
</div>
</body>
</html>`;
}

function paragraph(text: string): string {
	return `<p style="margin: 0 0 20px;">${escapeHtml(text)}</p>`;
}

const IGNORE = 'If this wasn’t you, ignore this email. Nothing changes.';

export function signInMail(
	to: string,
	purpose: 'verify' | 'login',
	link: string | null,
	code: string
): Mail {
	const verify = purpose === 'verify';
	const subject = verify ? 'Confirm your email for Torsel' : 'Your Torsel sign-in code';
	const lifetime = verify ? '24 hours' : '30 minutes';
	const shown = `${code.slice(0, 3)} ${code.slice(3)}`;
	const intro = verify
		? `Enter this code in Torsel to finish creating your account. It works once, for ${lifetime}.`
		: `Enter this code in Torsel to sign in. It works once, for ${lifetime}.`;
	const action = verify ? 'Confirm my email' : 'Sign in';

	const button =
		link === null
			? ''
			: `<p style="margin: 0 0 20px;"><a href="${escapeHtml(link)}" style="display: inline-block; padding: 10px 18px; background: #17181c; color: #ffffff; border-radius: 3px; font-weight: 600; text-decoration: none;">${action}</a></p>`;

	return {
		to,
		subject,
		text: [
			intro,
			shown,
			...(link === null ? [] : [`Or open this link on this device: ${link}`]),
			IGNORE
		].join('\n\n'),
		html: frame(
			[
				paragraph(intro),
				`<p style="margin: 0 0 20px; font-size: 28px; font-weight: 600; letter-spacing: 0.12em;">${shown}</p>`,
				button,
				`<p style="margin: 0; color: #62656d; font-size: 13px;">${escapeHtml(IGNORE)}</p>`
			].join('\n')
		),
		...(link === null ? {} : { link }),
		code
	};
}

export function passwordNoticeMail(to: string, kind: 'set' | 'dropped'): Mail {
	const body =
		kind === 'set'
			? 'The password on your Torsel account was just set or changed. If this wasn’t you, sign in with an emailed code and set a new one.'
			: 'You confirmed your Torsel account from a different browser than the one that created it, so its password was removed. Set a new one in Settings, or keep signing in with an emailed code.';

	return {
		to,
		subject: 'Your Torsel password changed',
		text: body,
		html: frame(paragraph(body))
	};
}
