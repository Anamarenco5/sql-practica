// Utilidades para las pruebas: crear usuarios de prueba y limpiarlos al final.
import crypto from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { getAppPool } from '../src/db/connections.js';

export const TEST_DOMAIN = '@prueba.test';

/** Registra un usuario nuevo y devuelve un "agente" que conserva la cookie de sesión. */
export async function newUser(app: Express, opts: { email?: string; name?: string } = {}) {
  const agent = request.agent(app);
  const email = opts.email ?? `u${crypto.randomBytes(5).toString('hex')}${TEST_DOMAIN}`;
  const ip = `198.51.100.${crypto.randomInt(1, 255)}`;
  const res = await agent.post('/api/auth/register').set('X-Forwarded-For', ip).send({ email, name: opts.name ?? 'Prueba', password: 'clave-segura-123' });
  if (res.status !== 201) throw new Error(`No se pudo registrar ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body as { id: number; email: string; isAdmin: boolean }, email };
}

/** Borra los usuarios de prueba y todo lo que crearon. */
export async function cleanupTestUsers(): Promise<void> {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT id_usuario FROM usuarios WHERE email LIKE ?', [`%${TEST_DOMAIN}`]);
  const ids = (rows as { id_usuario: number }[]).map((r) => r.id_usuario);
  if (ids.length === 0) return;
  await pool.query('DELETE FROM intentos WHERE id_usuario IN (?)', [ids]);
  await pool.query('DELETE FROM borradores WHERE id_usuario IN (?)', [ids]);
  await pool.query('DELETE FROM ejercicios_personalizados WHERE id_usuario IN (?)', [ids]);
  await pool.query('DELETE FROM usuarios WHERE id_usuario IN (?)', [ids]); // las sesiones caen en cascada
}
