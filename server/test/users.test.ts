// Versión multiusuario: cuentas, sesiones, aislamiento entre personas y permisos de administradora.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { closePools, getAppPool } from '../src/db/connections.js';
import { closeSandboxPool } from '../src/db/sandbox.js';
import { cleanupTestUsers, newUser, TEST_DOMAIN } from './helpers.js';

const app = createApp();

afterAll(async () => {
  await cleanupTestUsers();
  await closeSandboxPool();
  await closePools();
});

const customDef = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  topic: 'consultas-basicas',
  difficulty: 'basico',
  dataset: 'universidad',
  mode: 'readonly',
  statement: 'Aulas con capacidad mayor a 45.',
  tables: ['aulas'],
  solution: 'SELECT nombre, capacidad FROM aulas WHERE capacidad > 45',
  check: { type: 'result' },
  ...extra,
});

describe('contraseñas', () => {
  it('se guardan con hash y sal distinta cada vez', async () => {
    const a = await hashPassword('mi-clave-123');
    const b = await hashPassword('mi-clave-123');
    expect(a).not.toBe(b);
    expect(a).not.toContain('mi-clave-123');
    expect(await verifyPassword('mi-clave-123', a)).toBe(true);
    expect(await verifyPassword('otra-clave', a)).toBe(false);
  });

  it('en la base no queda la contraseña en texto plano', async () => {
    const { email } = await newUser(app);
    const [rows] = await getAppPool().query('SELECT hash_clave FROM usuarios WHERE email = ?', [email]);
    const hash = (rows as { hash_clave: string }[])[0].hash_clave;
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('clave-segura-123');
  });
});

describe('registro, login y sesión', () => {
  it('sin sesión no se puede usar la API', async () => {
    expect((await request(app).get('/api/exercises')).status).toBe(401);
    expect((await request(app).post('/api/exercises/u-basico-01/run').send({ sql: 'SELECT 1' })).status).toBe(401);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/topics')).status).toBe(200); // pública
  });

  it('registro → sesión → logout → login', async () => {
    const { agent, email } = await newUser(app, { name: 'Ana' });
    const me = await agent.get('/api/auth/me');
    expect(me.body).toMatchObject({ email, name: 'Ana', isAdmin: false });
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const bad = await agent.post('/api/auth/login').send({ email, password: 'incorrecta' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('Email o contraseña incorrectos.');
    const ok = await agent.post('/api/auth/login').send({ email: email.toUpperCase(), password: 'clave-segura-123' });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('la cookie es HttpOnly y SameSite', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: `cookie${Date.now()}${TEST_DOMAIN}`, name: 'C', password: 'clave-segura-123' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('valida los datos y no permite emails repetidos', async () => {
    const corta = await request(app).post('/api/auth/register').send({ email: `x${Date.now()}${TEST_DOMAIN}`, name: 'X', password: '123' });
    expect(corta.status).toBe(400);
    expect(corta.body.error).toMatch(/8 caracteres/);
    const mal = await request(app).post('/api/auth/register').send({ email: 'no-es-email', name: 'X', password: 'clave-segura-123' });
    expect(mal.status).toBe(400);
    const { email } = await newUser(app);
    const dup = await request(app).post('/api/auth/register').send({ email, name: 'Otra', password: 'clave-segura-123' });
    expect(dup.status).toBe(409);
  });

  it('una sesión inventada no sirve', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'sqlp_sesion=inventado123');
    expect(res.status).toBe(401);
  });
});

describe('aislamiento entre personas', () => {
  let ana: Awaited<ReturnType<typeof newUser>>;
  let beto: Awaited<ReturnType<typeof newUser>>;
  beforeAll(async () => {
    ana = await newUser(app, { name: 'Ana' });
    beto = await newUser(app, { name: 'Beto' });
  });

  it('el progreso y los borradores son de cada uno', async () => {
    await ana.agent.post('/api/exercises/u-basico-01/check').send({ sql: 'SELECT * FROM aulas' });
    await ana.agent.put('/api/exercises/u-basico-01/draft').send({ sql: 'borrador de Ana' });
    const a = await ana.agent.get('/api/exercises/u-basico-01');
    const b = await beto.agent.get('/api/exercises/u-basico-01');
    expect(a.body.progress.solved).toBe(true);
    expect(a.body.draft).toBe('borrador de Ana');
    expect(b.body.progress).toBeNull();
    expect(b.body.draft).toBeNull();
    // Beto no puede ver la solución con el intento de Ana
    expect((await beto.agent.get('/api/exercises/u-basico-01/solution')).status).toBe(403);
    const reviewBeto = await beto.agent.get('/api/review');
    expect(reviewBeto.body.items).toEqual([]);
  });

  it('los ejercicios propios son privados', async () => {
    const created = await ana.agent.post('/api/custom-exercises').send(customDef('Privado de Ana'));
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await ana.agent.get(`/api/exercises/${id}`)).body.mine).toBe(true);
    // Beto no lo ve, no lo puede ejecutar, editar ni borrar
    expect((await beto.agent.get(`/api/exercises/${id}`)).status).toBe(404);
    expect((await beto.agent.post(`/api/exercises/${id}/run`).send({ sql: 'SELECT 1' })).status).toBe(404);
    expect((await beto.agent.put(`/api/custom-exercises/${id}`).send(customDef('hackeado'))).status).toBe(404);
    expect((await beto.agent.delete(`/api/custom-exercises/${id}`)).status).toBe(404);
    const lista = await beto.agent.get('/api/exercises');
    expect(lista.body.some((e: { id: string }) => e.id === id)).toBe(false);
  });

  it('alguien que no es admin no puede publicar para todos', async () => {
    const created = await beto.agent.post('/api/custom-exercises').send(customDef('Intento de publicar', { public: true }));
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await ana.agent.get(`/api/exercises/${id}`)).status).toBe(404);
  });
});

describe('administradora (ADMIN_EMAILS)', () => {
  it('publica ejercicios que ven todos, pero solo ella edita', async () => {
    // admin@prueba.com está en ADMIN_EMAILS del .env de pruebas; se usa un email con el dominio de prueba
    // agregándolo temporalmente a la lista
    const { config } = await import('../src/config.js');
    const adminEmail = `admin${Date.now()}${TEST_DOMAIN}`;
    config.adminEmails.push(adminEmail);
    const admin = await newUser(app, { email: adminEmail, name: 'Admin' });
    expect(admin.user.isAdmin).toBe(true);
    const alumna = await newUser(app);

    const created = await admin.agent.post('/api/custom-exercises').send(customDef('Ejercicio de la cátedra', { public: true }));
    expect(created.status).toBe(201);
    const id = created.body.id;
    const visto = await alumna.agent.get(`/api/exercises/${id}`);
    expect(visto.status).toBe(200);
    expect(visto.body.mine).toBe(false);
    expect(visto.body.canEdit).toBe(false);
    expect(visto.body.solution).toBeUndefined();
    expect((await alumna.agent.delete(`/api/custom-exercises/${id}`)).status).toBe(404);
    // la alumna lo puede resolver y su progreso es solo suyo
    const ok = await alumna.agent.post(`/api/exercises/${id}/check`).send({ sql: 'SELECT nombre, capacidad FROM aulas WHERE capacidad >= 50' });
    expect(ok.body.correct).toBe(true);
    config.adminEmails.pop();
  });
});

describe('límites de pedidos', () => {
  it('frena muchos intentos de login seguidos desde la misma IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const r = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email: `nadie${TEST_DOMAIN}`, password: 'x' });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });
});
