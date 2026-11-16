import { operation, serveOperation } from '#lib/server/api/v1.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	serveOperation(operation('listRows'), event, requireCredential(event.locals), getDatabase());

export const POST: RequestHandler = (event) =>
	serveOperation(operation('createRows'), event, requireCredential(event.locals), getDatabase());

export const PATCH: RequestHandler = (event) =>
	serveOperation(operation('updateRows'), event, requireCredential(event.locals), getDatabase());

export const DELETE: RequestHandler = (event) =>
	serveOperation(operation('deleteRows'), event, requireCredential(event.locals), getDatabase());
