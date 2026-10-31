/** Everything an anonymous request can reach, each with the reason it may. Exact paths only. */
export const PUBLIC_API_ROUTES: Record<string, string> = {
	'/api/health': 'the Server form and the reverse proxy probe it before anyone is signed in',
	'/api/auth/config': 'the sign-in page reads which methods this server offers',
	'/api/auth/session': 'the app asks whether this visitor has an account; null for one with none',
	'/api/auth/lookup': 'the first sign-in step, rate limited',
	'/api/auth/signup': 'account creation, off unless the server opts in, rate limited',
	'/api/auth/login': 'password sign-in, throttled',
	'/api/auth/login-link': 'requests an emailed sign-in, rate limited',
	'/api/auth/verify-code': 'the emailed code is the credential, capped per code',
	'/api/auth/verify-link': 'the emailed token is the credential',
	'/api/auth/google': 'the OAuth round trip, which starts with no session'
};
