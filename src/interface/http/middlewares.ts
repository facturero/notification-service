export interface RequestUser {
  userId: string;
}

/** Middleware basado en headers inyectados por el gateway (X-User-Id viene del
 * claim `sub` del JWT). El servicio NO valida JWT: solo confía en el gateway. */
export function readUser(c: { req: { header(name: string): string | undefined } }): RequestUser {
  const userId = c.req.header('X-User-Id') || '';
  if (!userId) {
    const err: any = new Error('Falta X-User-Id (el gateway debe inyectarlo)');
    err.statusCode = 401;
    throw err;
  }
  return { userId };
}