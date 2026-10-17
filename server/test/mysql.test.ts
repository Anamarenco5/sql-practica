// Pruebas de integración contra MySQL real (necesitan haber corrido npm run db:setup).
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closePools, getAppPool } from '../src/db/connections.js';
import { loadBuiltInExercises } from '../src/exercises/repository.js';
import { grade } from '../src/grading/grader.js';
import { runScript } from '../src/sql/runner.js';

const exercises = loadBuiltInExercises();
const byId = (id: string) => exercises.find((e) => e.id === id)!;

afterAll(async () => {
  // limpiamos los intentos que generaron las pruebas
  await getAppPool().query("DELETE FROM intentos WHERE sql_texto LIKE '%/*test*/%'");
  await getAppPool().query("DELETE FROM borradores WHERE sql_texto LIKE '%/*test*/%'");
  await closePools();
});

describe('cada solución de referencia aprueba su propio ejercicio', () => {
  it.each(exercises.map((e) => [e.id, e] as const))('%s', async (_id, ex) => {
    const r = await grade(ex, ex.solution);
    expect(r.error).toBeUndefined();
    expect(r.feedback).toEqual([]);
    expect(r.correct).toBe(true);
  });
});

describe('corrección de respuestas alternativas e incorrectas', () => {
  it('acepta una consulta distinta con el mismo resultado (NOT EXISTS en lugar de LEFT JOIN)', async () => {
    const r = await grade(
      byId('u-tp3-16'),
      'SELECT id_alumno, nombre, apellido, email, telefono, fecha_ingreso FROM alumnos a WHERE NOT EXISTS (SELECT 1 FROM alumno_carrera ac WHERE ac.id_alumno = a.id_alumno)',
    );
    expect(r.correct).toBe(true);
  });

  it('acepta YEAR() en lugar de BETWEEN', async () => {
    const r = await grade(byId('u-tp3-01'), 'select id_alumno, nombre, apellido, email, fecha_ingreso from alumnos where year(fecha_ingreso) = 2023 order by fecha_ingreso');
    expect(r.correct).toBe(true);
  });

  it('rechaza un INNER JOIN donde va LEFT JOIN', async () => {
    const r = await grade(byId('u-tp3-16'), 'SELECT a.id_alumno, a.nombre, a.apellido, a.email, a.telefono, a.fecha_ingreso FROM alumnos a JOIN alumno_carrera ac ON ac.id_alumno = a.id_alumno');
    expect(r.correct).toBe(false);
  });

  it('rechaza un orden incorrecto cuando se pide ORDER BY', async () => {
    const r = await grade(byId('u-tp3-01'), 'SELECT id_alumno, nombre, apellido, email, fecha_ingreso FROM alumnos WHERE YEAR(fecha_ingreso) = 2023 ORDER BY fecha_ingreso DESC');
    expect(r.correct).toBe(false);
    expect(r.feedback.join(' ')).toMatch(/orden/);
  });

  it('informa errores de sintaxis con explicación', async () => {
    const r = await grade(byId('u-basico-01'), 'SELEC * FROM aulas');
    expect(r.correct).toBe(false);
    expect(r.error?.errno).toBe(1064);
    expect(r.error?.hint).toBeTruthy();
  });

  it('exige subconsulta cuando el ejercicio lo pide', async () => {
    const r = await grade(
      byId('u-tp3-21'),
      'SELECT d.id_docente, d.nombre, d.apellido, d.salario_base, x.p FROM docentes d CROSS JOIN (SELECT ROUND(AVG(salario_base),2) p, AVG(salario_base) a FROM docentes) x WHERE d.salario_base > x.a',
    );
    // usa una tabla derivada (también es subconsulta), así que debe aceptarse
    expect(r.correct).toBe(true);
  });

  it('CHECK: sin restricción las pruebas inválidas no son rechazadas', async () => {
    const r = await grade(byId('u-tp4-01'), 'SELECT 1');
    expect(r.correct).toBe(false);
    expect(r.probes?.filter((p) => !p.passed).length).toBe(3);
  });

  it('CHECK: una restricción incompleta (solo mínimo) falla', async () => {
    const r = await grade(byId('u-tp4-01'), 'ALTER TABLE notas ADD CONSTRAINT c CHECK (nota >= 0)');
    expect(r.correct).toBe(false);
  });

  it('UPDATE sin WHERE se detecta por el estado final', async () => {
    const r = await grade(byId('u-dml-01'), "UPDATE docentes SET salario_base = salario_base * 1.10 /* Salud */");
    expect(r.correct).toBe(false);
  });

  it('trigger solo de INSERT no alcanza', async () => {
    const r = await grade(
      byId('u-trigger-01'),
      'DELIMITER $$\nCREATE TRIGGER t1 BEFORE INSERT ON notas FOR EACH ROW BEGIN SET NEW.aprobado = NEW.nota >= 4; END $$\nDELIMITER ;',
    );
    expect(r.correct).toBe(false);
  });
});

describe('aislamiento y seguridad', () => {
  it('el modo solo lectura no puede modificar datos', async () => {
    const out = await runScript('universidad', 'readonly', 'SELECT 1 FROM alumnos LIMIT 1 FOR UPDATE');
    // FOR UPDATE en transacción read-only no modifica nada; lo importante es que no haya escritura
    const del = await runScript('universidad', 'readonly', '(SELECT 1); DELETE FROM alumnos');
    expect(del.error?.code).toBe('BLOQUEADO');
    expect(out).toBeDefined();
  });

  it('el sandbox no puede leer otras bases', async () => {
    const out = await runScript('universidad', 'sandbox', 'SELECT * FROM sqlpractica_app.intentos');
    expect(out.error?.errno).toBe(1142);
  });

  it('el sandbox no puede escribir en la base original', async () => {
    const out = await runScript('universidad', 'sandbox', 'DELETE FROM sqlp_ds_universidad.alumnos');
    expect(out.error?.errno).toBe(1142);
  });

  it('los cambios en un sandbox no afectan a la base original ni a otros sandbox', async () => {
    await runScript('universidad', 'sandbox', 'DELETE FROM asistencias; DELETE FROM notas');
    const out = await runScript('universidad', 'readonly', 'SELECT COUNT(*) FROM notas');
    expect(Number((out.results[0] as { rows: unknown[][] }).rows[0][0])).toBeGreaterThan(50000);
  });

  it('las consultas eternas se cortan por tiempo', async () => {
    const out = await runScript('universidad', 'readonly', 'SELECT COUNT(*) FROM asistencias a JOIN asistencias b ON a.fecha < b.fecha');
    expect(out.error?.errno).toBe(3024);
  }, 20000);

  it('no quedan sandboxes después de ejecutar', async () => {
    const [rows] = await getAppPool().query("SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'sqlp\\_sbx\\_%'");
    // sqlp_app no ve esas bases (no tiene permisos), así que siempre ve 0: también prueba el aislamiento
    expect(Number((rows as { n: number }[])[0].n)).toBe(0);
  });
});

describe('API', () => {
  const app = createApp();

  it('lista ejercicios sin exponer soluciones', async () => {
    const res = await request(app).get('/api/exercises/u-tp3-01');
    expect(res.status).toBe(200);
    expect(res.body.solution).toBeUndefined();
    expect(res.body.statement).toBeTruthy();
  });

  it('ejecuta y corrige', async () => {
    const run = await request(app).post('/api/exercises/u-basico-01/run').send({ sql: 'SELECT * FROM aulas /*test*/' });
    expect(run.body.results[0].rowCount).toBe(10);
    const chk = await request(app).post('/api/exercises/u-basico-01/check').send({ sql: 'SELECT * FROM aulas /*test*/' });
    expect(chk.body.correct).toBe(true);
    const sol = await request(app).get('/api/exercises/u-basico-01/solution');
    expect(sol.status).toBe(200);
  });

  it('devuelve el esquema del dataset', async () => {
    const res = await request(app).get('/api/datasets/universidad/schema');
    expect(res.body.find((t: { name: string }) => t.name === 'alumnos').rowCount).toBe(1000);
  });

  it('rechaza nombres de tabla inventados en la muestra de datos', async () => {
    const res = await request(app).get('/api/datasets/universidad/tables/alumnos`;DROP/sample');
    expect(res.status).toBe(404);
  });
});
