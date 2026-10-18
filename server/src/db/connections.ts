// Conexiones a MySQL. Hay tres usuarios con permisos mínimos y separados:
//   - app:     lee/escribe el progreso (base sqlpractica_app). Usa pool.
//   - reader:  solo SELECT sobre las bases de práctica sqlp_ds_* (ejercicios de consulta).
//   - sandbox: todo, pero SOLO dentro de bases temporales sqlp_sbx_* (ejercicios de modificación).
// Las consultas de los ejercicios usan conexiones dedicadas (no compartidas), para
// que una variable de sesión o una transacción abierta no se filtre a otra ejecución.
import mysql, { type Connection, type Pool } from 'mysql2/promise';
import { config } from '../config.js';

const common = {
  host: config.mysql.host,
  port: config.mysql.port,
  dateStrings: true as const, // fechas como texto 'YYYY-MM-DD', igual que en Workbench
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: false, // DECIMAL como texto: no perdemos precisión
  multipleStatements: false, // dividimos el script nosotros (ver splitter.ts)
  connectTimeout: 10000,
  charset: 'utf8mb4',
  ssl: config.mysql.ssl,
};

let appPool: Pool | null = null;
export function getAppPool(): Pool {
  if (!appPool) {
    appPool = mysql.createPool({
      ...common,
      user: config.app.user,
      password: config.app.password(),
      database: config.app.database,
      connectionLimit: config.mysql.appPoolSize,
    });
  }
  return appPool;
}

export type Role = 'reader' | 'sandbox';

export async function openConnection(role: Role, database?: string): Promise<Connection> {
  const cred = role === 'reader' ? config.reader : config.sandbox;
  return mysql.createConnection({
    ...common,
    user: cred.user,
    password: cred.password(),
    database,
  });
}

export async function closePools(): Promise<void> {
  if (appPool) {
    await appPool.end();
    appPool = null;
  }
}
