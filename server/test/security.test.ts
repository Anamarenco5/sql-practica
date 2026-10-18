// Etapa 5: ataques reales contra el motor de ejecución y la API, carga concurrente
// y persistencia. Necesita MySQL con "npm run db:setup" hecho.
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, newUser } from './helpers.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { closePools, getAppPool } from '../src/db/connections.js';
import { grantMode } from '../src/db/grants.js';
import { cleanupOrphanSandboxes, closeSandboxPool, createSandbox } from '../src/db/sandbox.js';
import { findExercise } from '../src/exercises/repository.js';
import { grade } from '../src/grading/grader.js';
import { getProgress, recordAttempt } from '../src/progress/store.js';
import { runScript } from '../src/sql/runner.js';

afterAll(async () => {
  await getAppPool().query("DELETE FROM intentos WHERE sql_texto LIKE '%/*sec*/%'");
  await cleanupTestUsers();
  await closeSandboxPool();
  await closePools();
});

// Con partial_revokes (Aiven) el usuario sandbox no puede crear bases ni ver las ajenas:
// para preparar y revisar las pruebas de limpieza se usa el administrador.
const managerConn = async () => {
  const cred = (await grantMode()) === 'por-base' ? config.admin : config.sandbox;
  return mysql.createConnection({ host: config.mysql.host, port: config.mysql.port, user: cred.user, password: cred.password(), ssl: config.mysql.ssl });
};

const sandboxDbs = async () => {
  const conn = await managerConn();
  try {
    const [rows] = await conn.query("SHOW DATABASES LIKE 'sqlp\\_sbx\\_%'");
    return (rows as Record<string, string>[]).map((r) => Object.values(r)[0]);
  } finally {
    await conn.end();
  }
};

describe('escalada de privilegios y acceso a otras bases', () => {
  const casos: [string, 'readonly' | 'sandbox', string][] = [
    ['leer usuarios del servidor', 'readonly', 'SELECT user, host FROM mysql.user'],
    ['leer usuarios escondido en comentario versionado', 'readonly', 'SELECT 1 /*!50000 , (SELECT COUNT(*) FROM mysql.user) */'],
    ['leer el progreso desde un ejercicio', 'readonly', 'SELECT * FROM sqlpractica_app.intentos'],
    ['borrar la base original desde un sandbox', 'sandbox', 'DELETE FROM sqlp_ds_universidad.notas'],
    ['crear tablas en la base original', 'sandbox', 'CREATE TABLE sqlp_ds_universidad.x (a INT)'],
    ['cambiar variables de sesión protegidas', 'sandbox', 'SET SESSION sql_log_bin = 0'],
    ['leer archivos del servidor', 'readonly', "SELECT LOAD_FILE('/etc/passwd')"],
    ['escribir archivos', 'readonly', "SELECT 1 INTO OUTFILE '/tmp/x'"],
    ['SQL dinámico', 'sandbox', "SET @s = 'SELECT 1'; PREPARE st FROM @s; EXECUTE st;"],
    ['eventos programados', 'sandbox', 'CREATE EVENT e ON SCHEDULE EVERY 1 SECOND DO DELETE FROM notas'],
    ['crear usuarios', 'sandbox', "CREATE USER 'x'@'%' IDENTIFIED BY 'x'"],
    ['cambiar de base', 'sandbox', 'USE sqlpractica_app'],
    ['modificar en un ejercicio de consulta', 'readonly', '(SELECT 1); UPDATE alumnos SET nombre = NULL'],
    ['modificar con CTE en un ejercicio de consulta', 'readonly', 'WITH x AS (SELECT 1) UPDATE alumnos SET nombre = NULL'],
  ];
  it.each(casos)('%s: rechazado', async (_n, mode, sql) => {
    const out = await runScript('universidad', mode, sql);
    expect(out.error).toBeDefined();
  });

  it('la base original sigue intacta', async () => {
    const out = await runScript('universidad', 'readonly', 'SELECT (SELECT COUNT(*) FROM notas), (SELECT COUNT(*) FROM alumnos WHERE nombre IS NULL)');
    const [notas, nulos] = (out.results[0] as { rows: unknown[][] }).rows[0];
    expect(Number(notas)).toBe(54661);
    expect(Number(nulos)).toBe(0);
  });
});

describe('agotamiento de recursos', () => {
  it('un bucle infinito en un procedimiento se corta', async () => {
    const t0 = Date.now();
    const out = await runScript(
      'universidad',
      'sandbox',
      'DELIMITER $$\nCREATE PROCEDURE p() BEGIN DECLARE i INT DEFAULT 0; WHILE 1 = 1 DO SET i = i + 1; END WHILE; END $$\nDELIMITER ;\nCALL p();',
    );
    expect(out.error?.errno).toBe(1317);
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 30000);

  it('un procedimiento que devuelve millones de filas no agota la memoria', async () => {
    const before = process.memoryUsage().rss;
    const out = await runScript('universidad', 'sandbox', 'DELIMITER $$\nCREATE PROCEDURE big() BEGIN SELECT a.id_nota FROM notas a, notas b; END $$\nDELIMITER ;\nCALL big();');
    const rows = out.results.find((r) => r.kind === 'rows') as { rowCount: number; truncated: boolean };
    expect(rows.rowCount).toBe(config.limits.maxRows);
    expect(rows.truncated).toBe(true);
    expect(process.memoryUsage().rss - before).toBeLessThan(200e6);
  }, 30000);

  it('un SELECT gigante se trunca sin cancelar la sentencia siguiente', async () => {
    const out = await runScript('universidad', 'readonly', 'SELECT a.id_nota FROM notas a, alumnos b; SELECT 42');
    expect(out.error).toBeUndefined();
    expect((out.results[0] as { truncated: boolean }).truncated).toBe(true);
    expect(Number((out.results[1] as { rows: unknown[][] }).rows[0][0])).toBe(42);
  }, 30000);

  it('scripts demasiado largos o con demasiadas sentencias se rechazan', async () => {
    expect((await runScript('universidad', 'readonly', 'SELECT 1;'.repeat(31))).error?.code).toBe('ENTRADA_INVALIDA');
    expect((await runScript('universidad', 'readonly', `SELECT '${'x'.repeat(20001)}'`)).error?.code).toBe('ENTRADA_INVALIDA');
  });
});

describe('limpieza de sandboxes', () => {
  it('borra bases sqlp_sbx_ con nombres extraños y respeta las recientes', async () => {
    const conn = await managerConn();
    await conn.query('CREATE DATABASE IF NOT EXISTS sqlp_sbx_huerfana');
    const reciente = `sqlp_sbx_${Date.now().toString(36)}_0123abcd`;
    await conn.query(`CREATE DATABASE \`${reciente}\``);
    await cleanupOrphanSandboxes();
    const quedan = await sandboxDbs();
    expect(quedan).not.toContain('sqlp_sbx_huerfana');
    expect(quedan).toContain(reciente);
    await conn.query(`DROP DATABASE \`${reciente}\``);
    await conn.end();
  });

  it('con partial_revokes: el sandbox solo accede a su copia y el permiso se quita al terminar', async () => {
    if ((await grantMode()) !== 'por-base') return; // solo aplica a servidores como Aiven
    const a = await createSandbox('universidad');
    const b = await createSandbox('universidad');
    try {
      await expect(a.conn.query('CREATE DATABASE sqlp_sbx_ajena')).rejects.toThrow(/denied/i);
      await expect(a.conn.query('DELETE FROM sqlp_ds_universidad.notas')).rejects.toThrow(/denied/i);
      await expect(b.conn.query('SELECT COUNT(*) FROM notas')).resolves.toBeDefined();
    } finally {
      await a.dispose();
      await b.dispose();
    }
    // Después de borrar, el usuario sandbox no puede recrear la base con el mismo nombre.
    const conn = await mysql.createConnection({ host: config.mysql.host, port: config.mysql.port, user: config.sandbox.user, password: config.sandbox.password(), ssl: config.mysql.ssl });
    try {
      await expect(conn.query(`CREATE DATABASE \`${a.name}\``)).rejects.toThrow(/denied/i);
    } finally {
      await conn.end();
    }
  });
});

describe('API: acceso solo local', () => {
  const app = createApp();
  let agent: Awaited<ReturnType<typeof newUser>>['agent'];
  beforeAll(async () => {
    agent = (await newUser(app)).agent;
  });

  it('rechaza un Host ajeno (DNS rebinding)', async () => {
    const res = await request(app).get('/api/exercises').set('Host', 'atacante.com');
    expect(res.status).toBe(403);
  });

  it('rechaza pedidos desde otra web (Origin ajeno)', async () => {
    const res = await request(app).post('/api/exercises/u-basico-01/check').set('Origin', 'https://atacante.com').send({ sql: 'SELECT 1 /*sec*/' });
    expect(res.status).toBe(403);
  });

  it('acepta pedidos de la propia app', async () => {
    const res = await request(app).get('/api/topics').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rechaza cuerpos que no son JSON (formularios de otras webs)', async () => {
    const res = await request(app).post('/api/exercises/u-basico-01/run').set('Content-Type', 'text/plain').send('{"sql":"SELECT 1"}');
    expect(res.status).toBe(415);
  });

  it('valida los datos de entrada', async () => {
    const res = await agent.post('/api/exercises/u-basico-01/run').send({ sql: 123 });
    expect(res.status).toBe(400);
  });

  it('no filtra detalles internos en los errores', async () => {
    const res = await agent.get('/api/datasets/inexistente/schema');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at |\.ts|password/i);
  });
});

describe('carga concurrente', () => {
  it('20 comprobaciones simultáneas de ejercicios de modificación terminan bien', async () => {
    const ex = (await findExercise('u-tp4-03', { id: 0, isAdmin: false }))!;
    const antes = (await sandboxDbs()).length;
    const t0 = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, () => grade(ex, ex.solution)));
    expect(results.every((r) => r.correct)).toBe(true);
    // no se superó el límite de conexiones del usuario sandbox ni quedaron bases sueltas
    const quedan = (await sandboxDbs()).length;
    expect(quedan - antes).toBeLessThanOrEqual(config.limits.sandboxPool);
    console.log(`20 comprobaciones en ${Date.now() - t0} ms`);
  }, 120000);

  it('50 consultas simultáneas de solo lectura', async () => {
    const ex = (await findExercise('u-tp3-14', { id: 0, isAdmin: false }))!;
    const results = await Promise.all(Array.from({ length: 50 }, () => grade(ex, ex.solution)));
    expect(results.every((r) => r.correct)).toBe(true);
  }, 120000);
});

describe('persistencia', () => {
  it('el progreso sobrevive a cerrar y reabrir las conexiones (reinicio del servidor)', async () => {
    const { user } = await newUser(createApp());
    await recordAttempt({ userId: user.id, exerciseId: 'u-basico-02', sql: 'SELECT 1 /*sec*/', correct: true, hintsUsed: 1 });
    await closePools(); // como si se cerrara el servidor
    const p = (await getProgress(user.id)).get('u-basico-02');
    expect(p?.solved).toBe(true);
  });
});
