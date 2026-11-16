import { operation, serveOperation } from '#lib/server/api/v1.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	serveOperation(operation('query'), event, requireCredential(event.locals), getDatabase());
