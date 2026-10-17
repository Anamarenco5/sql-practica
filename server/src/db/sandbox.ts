// Sandboxes: copias temporales y descartables de una base de práctica.
// Cada ejecución de un ejercicio de modificación (INSERT/UPDATE/DELETE, ALTER,
// triggers, procedimientos, transacciones) corre sobre su propia copia
// sqlp_sbx_<aleatorio>, que se borra al terminar. Así nunca se "rompe" la base
// original y dos ejecuciones no se pisan entre sí.
import crypto from 'node:crypto';
import type { Connection } from 'mysql2/promise';
import { SANDBOX_PREFIX } from '../config.js';
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

export async function createSandbox(datasetId: string): Promise<Sandbox> {
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
      const created = parseInt(db.slice(SANDBOX_PREFIX.length).split('_')[0], 36);
      if (Number.isFinite(created) && Date.now() - created < olderThanMs) continue;
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
      n++;
    }
    return n;
  } finally {
    await conn.end();
  }
}
