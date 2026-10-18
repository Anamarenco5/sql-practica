// Permisos de los usuarios de práctica según cómo esté configurado el servidor MySQL.
//
// El aislamiento se basa en que sqlp_sandbox solo pueda tocar bases sqlp_sbx_*.
// Normalmente eso se logra con UN permiso con comodín:  GRANT ALL ON `sqlp\_sbx\_%`.*
//
// Pero si el servidor tiene activada la opción partial_revokes (Aiven la usa para
// proteger la base "mysql"), MySQL toma % y _ como caracteres LITERALES: el comodín
// deja de funcionar. En ese caso ("por-base") el servidor de la app, con el usuario
// administrador, crea cada sandbox y le da permiso a sqlp_sandbox solo sobre esa base;
// al terminar la borra y quita el permiso.
import mysql, { type Pool } from 'mysql2/promise';
import { config } from '../config.js';
import { openConnection } from './connections.js';

export type GrantMode = 'comodin' | 'por-base';

/**
 * Nombre exacto de una base para usar en un GRANT. Sin partial_revokes, `_` es un comodín
 * y hay que escribirlo `\_`; con partial_revokes ya es literal y la barra se tomaría
 * como parte del nombre.
 */
export function grantDbName(db: string, mode: GrantMode): string {
  if (!/^[a-z0-9_]+$/.test(db)) throw new Error(`Nombre de base inválido: ${db}`);
  return '`' + (mode === 'comodin' ? db.replace(/_/g, '\\_') : db) + '`';
}

let mode: Promise<GrantMode> | null = null;

/** Detecta el modo consultando al servidor (una sola vez). */
export function detectGrantMode(query: (sql: string) => Promise<unknown>): Promise<GrantMode> {
  if (!mode) {
    mode = query('SELECT @@partial_revokes AS p').then((r) => {
      const rows = (r as [{ p: number | string }[]])[0];
      return Number(rows[0]?.p) === 1 ? 'por-base' : 'comodin';
    });
    mode.catch(() => {
      mode = null;
    });
  }
  return mode;
}

let adminPool: Pool | null = null;

/** Pool chico del administrador; solo se usa en el modo "por-base". */
export function getAdminPool(): Pool {
  if (!adminPool) {
    adminPool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.admin.user,
      password: config.admin.password(),
      ssl: config.mysql.ssl,
      charset: 'utf8mb4',
      connectTimeout: 10000,
      multipleStatements: false,
      connectionLimit: 2,
    });
  }
  return adminPool;
}

export async function closeAdminPool(): Promise<void> {
  if (adminPool) {
    const p = adminPool;
    adminPool = null;
    await p.end().catch(() => {});
  }
}

/** Modo del servidor, consultado con el usuario sandbox (así en la PC no hace falta la clave de root). */
export function grantMode(): Promise<GrantMode> {
  return detectGrantMode(async (sql) => {
    const conn = await openConnection('sandbox');
    try {
      return await conn.query(sql);
    } finally {
      await conn.end().catch(() => {});
    }
  });
}

/** Modo "por-base": crea la base del sandbox y le da permisos a sqlp_sandbox solo sobre ella. */
export async function provisionSandboxDb(name: string): Promise<void> {
  const pool = getAdminPool();
  await pool.query(`CREATE DATABASE \`${name}\``);
  try {
    for (const host of config.mysql.userHosts) {
      await pool.query(`GRANT ALL PRIVILEGES ON ${grantDbName(name, 'por-base')}.* TO ?@?`, [config.sandbox.user, host]);
    }
  } catch (err) {
    await dropSandboxDb(name).catch(() => {});
    throw err;
  }
}

/** Modo "por-base": borra la base del sandbox y quita el permiso. */
export async function dropSandboxDb(name: string): Promise<void> {
  const pool = getAdminPool();
  await pool.query(`DROP DATABASE IF EXISTS \`${name}\``);
  for (const host of config.mysql.userHosts) {
    try {
      await pool.query(`REVOKE ALL PRIVILEGES ON ${grantDbName(name, 'por-base')}.* FROM ?@?`, [config.sandbox.user, host]);
    } catch (e) {
      // 1141: no había permiso que quitar (ya se había quitado). Cualquier otro error se informa.
      if ((e as { errno?: number }).errno !== 1141) throw e;
    }
  }
}
