// Sandboxes: copias temporales y descartables de una base de práctica.
// Cada ejecución de un ejercicio de modificación (INSERT/UPDATE/DELETE, ALTER,
// triggers, procedimientos, transacciones) corre sobre su propia copia
// sqlp_sbx_<aleatorio>, que se borra al terminar. Así nunca se "rompe" la base
// original y dos ejecuciones no se pisan entre sí.
import crypto from 'node:crypto';
import type { Connection } from 'mysql2/promise';
import { config, SANDBOX_PREFIX } from '../config.js';
import { openConnection } from './connections.js';
import { datasetDbName, getDataset } from './datasets.js';

interface TableDdl {
  name: string;
  createSql: string;
}

const ddlCache = new Map<string, TableDdl[]>();

async function getDdl(conn: Connection, datasetId: string): Promise<TableDdl[]> {
  const hit = ddlCache.get(datasetId);
  if (hit) return hit;
  const src = datasetDbName(datasetId);
  const [tables] = await conn.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    [src],
  );
  const out: TableDdl[] = [];
  for (const { t } of tables as { t: string }[]) {
    const [r] = await conn.query(`SHOW CREATE TABLE \`${src}\`.\`${t}\``);
    out.push({ name: t, createSql: (r as Record<string, string>[])[0]['Create Table'] });
  }
  ddlCache.set(datasetId, out);
  return out;
}

export interface Sandbox {
  name: string;
  conn: Connection;
  dispose: () => Promise<void>;
}

// ---- Pool de sandboxes precalentados ----
// Copiar la base tarda ~1-2 s. Para que "Comprobar" responda rápido, se mantienen
// algunas copias listas por dataset: se entrega una y se prepara otra en segundo plano.
const pool = new Map<string, Promise<Sandbox>[]>();
let poolClosed = false;

function refill(datasetId: string) {
  if (poolClosed || config.limits.sandboxPool <= 0) return;
  const q = pool.get(datasetId) ?? [];
  pool.set(datasetId, q);
  while (q.length < config.limits.sandboxPool) {
    const p = buildSandbox(datasetId);
    p.catch(() => {
      const i = q.indexOf(p);
      if (i >= 0) q.splice(i, 1);
    });
    q.push(p);
  }
}

/** Entrega un sandbox nuevo (del pool si hay uno listo) y repone el pool. */
export async function createSandbox(datasetId: string): Promise<Sandbox> {
  const next = pool.get(datasetId)?.shift();
  refill(datasetId);
  if (next) {
    try {
      return await next;
    } catch {
      /* si el precalentado falló, se crea uno en el momento */
    }
  }
  return buildSandbox(datasetId);
}

/** Libera los sandboxes del pool (al cerrar el servidor o al terminar las pruebas). */
export async function closeSandboxPool(): Promise<void> {
  poolClosed = true;
  const all = [...pool.values()].flat();
  pool.clear();
  await Promise.all(all.map((p) => p.then((s) => s.dispose()).catch(() => {})));
}

async function buildSandbox(datasetId: string): Promise<Sandbox> {
  const ds = getDataset(datasetId);
  if (!ds) throw new Error(`Dataset desconocido: ${datasetId}`);
  // El nombre lleva la hora de creación para poder limpiar huérfanos viejos sin tocar los activos.
  const name = `${SANDBOX_PREFIX}${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const conn = await openConnection('sandbox');
  const dispose = async () => {
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    } catch {
      // la conexión pudo quedar inutilizable (timeout, error fatal): usamos otra
      const c2 = await openConnection('sandbox');
      await c2.query(`DROP DATABASE IF EXISTS \`${name}\``).finally(() => c2.end());
    } finally {
      await conn.end().catch(() => {});
    }
  };
  try {
    await conn.query(`CREATE DATABASE \`${name}\``);
    await conn.query(`USE \`${name}\``);
    const ddl = await getDdl(conn, datasetId);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ddl) {
      await conn.query(t.createSql); // incluye PK, FK, CHECK, índices y AUTO_INCREMENT
      if (!ds.sandbox.skipData.includes(t.name)) {
        await conn.query(`INSERT INTO \`${t.name}\` SELECT * FROM \`${datasetDbName(datasetId)}\`.\`${t.name}\``);
      }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    return { name, conn, dispose };
  } catch (err) {
    await dispose();
    throw err;
  }
}

/** Borra sandboxes que hayan quedado de una ejecución interrumpida (ej: se cortó el servidor). */
export async function cleanupOrphanSandboxes(olderThanMs = 10 * 60 * 1000): Promise<number> {
  const conn = await openConnection('sandbox');
  try {
    const [rows] = await conn.query(`SHOW DATABASES LIKE 'sqlp\\_sbx\\_%'`);
    let n = 0;
    for (const r of rows as Record<string, string>[]) {
      const db = Object.values(r)[0];
      // Solo se respetan las bases recientes con el formato exacto que genera la app
      // (sqlp_sbx_<hora base36>_<8 hex>); cualquier otra se considera huérfana.
      const m = /^sqlp_sbx_([0-9a-z]+)_[0-9a-f]{8}$/.exec(db);
      const created = m ? parseInt(m[1], 36) : NaN;
      const age = Date.now() - created;
      if (Number.isFinite(created) && age >= 0 && age < olderThanMs) continue;
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
      n++;
    }
    return n;
  } finally {
    await conn.end();
  }
}
