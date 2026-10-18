// Cuentas y sesiones.
// - La sesión es un token aleatorio en una cookie HttpOnly (JavaScript no la puede leer).
// - En la base solo se guarda el SHA-256 del token: si se filtrara la tabla, no sirve para entrar.
// - SameSite=Lax + verificación de Origin (app.ts) evitan pedidos desde otras webs.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { config } from '../config.js';
import { getAppPool } from '../db/connections.js';
import { hashPassword, verifyPassword } from './passwords.js';

export const COOKIE = 'sqlp_sesion';

export interface User {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const RegisterInput = z.object({
  email: z.string().trim().toLowerCase().email('El email no es válido.').max(190),
  name: z.string().trim().min(1, 'Escribí tu nombre.').max(80),
  password: z.string().min(8, 'La contraseña tiene que tener al menos 8 caracteres.').max(200),
});

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().max(190),
  password: z.string().max(200),
});

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function toUser(r: RowDataPacket): User {
  return { id: Number(r.id_usuario), email: r.email, name: r.nombre, isAdmin: Boolean(r.es_admin) };
}

/** Marca como administradora a quien figure en ADMIN_EMAILS (se revisa en cada login). */
async function syncAdmin(user: User): Promise<User> {
  const shouldBe = config.adminEmails.includes(user.email.toLowerCase());
  if (shouldBe !== user.isAdmin) {
    await getAppPool().query('UPDATE usuarios SET es_admin = ? WHERE id_usuario = ?', [shouldBe, user.id]);
    return { ...user, isAdmin: shouldBe };
  }
  return user;
}

export async function register(input: z.infer<typeof RegisterInput>): Promise<User> {
  const hash = await hashPassword(input.password);
  try {
    const [r] = await getAppPool().query('INSERT INTO usuarios (email, nombre, hash_clave) VALUES (?, ?, ?)', [input.email, input.name, hash]);
    const id = (r as { insertId: number }).insertId;
    return syncAdmin({ id, email: input.email, name: input.name, isAdmin: false });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AuthError('Ya existe una cuenta con ese email. Iniciá sesión.', 409);
    throw e;
  }
}

// Hash de una contraseña cualquiera: se usa cuando el email no existe, para que la
// respuesta tarde lo mismo y no revele qué emails están registrados.
const dummyHash = hashPassword('contraseña-de-relleno');

export async function login(input: z.infer<typeof LoginInput>): Promise<User> {
  const [rows] = await getAppPool().query<RowDataPacket[]>('SELECT * FROM usuarios WHERE email = ?', [input.email]);
  const ok = rows.length > 0 ? await verifyPassword(input.password, rows[0].hash_clave) : (await verifyPassword(input.password, await dummyHash), false);
  if (!ok) throw new AuthError('Email o contraseña incorrectos.', 401);
  return syncAdmin(toUser(rows[0]));
}

export async function createSession(res: Response, userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = config.auth.sessionDays;
  await getAppPool().query('INSERT INTO sesiones (token_hash, id_usuario, expira) VALUES (?, ?, NOW() + INTERVAL ? DAY)', [sha256(token), userId, days]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
    maxAge: days * 24 * 3600 * 1000,
  });
}

function readToken(req: Request): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = readToken(req);
  if (token) await getAppPool().query('DELETE FROM sesiones WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Middleware: si hay una sesión válida, deja el usuario en req.user. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token && token.length < 100) {
    const [rows] = await getAppPool().query<RowDataPacket[]>(
      `SELECT u.* FROM sesiones s JOIN usuarios u ON u.id_usuario = s.id_usuario
        WHERE s.token_hash = ? AND s.expira > NOW()`,
      [sha256(token)],
    );
    if (rows.length > 0) req.user = toUser(rows[0]);
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
  next();
}

/** Borra sesiones vencidas (se llama periódicamente). */
export async function purgeExpiredSessions(): Promise<void> {
  await getAppPool().query('DELETE FROM sesiones WHERE expira <= NOW()');
}
