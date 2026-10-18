// Lógica del setup, compartida por "npm run db:setup" y por el arranque automático
// en la nube (AUTO_SETUP=1). Usa el usuario administrador SOLO durante el setup.
//   1. Crea la base de la app (usuarios, sesiones, progreso) y migra versiones anteriores.
//   2. Crea los usuarios sqlp_app, sqlp_reader y sqlp_sandbox con permisos mínimos.
//   3. Carga los datasets de db/datasets/ como sqlp_ds_<id>.
import fs from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { config, DATASET_PREFIX } from '../config.js';
import { datasetDbName, datasetScriptPath, listDatasets } from '../db/datasets.js';
import { splitSql } from '../sql/splitter.js';
import { migrateAppSchema } from './appSchema.js';

export interface SetupOptions {
  /** 'all' recarga todos; 'missing' solo carga los que no existen; o una lista de ids. */
  datasets: 'all' | 'missing' | string[];
  log?: (msg: string) => void;
}

export async function openAdmin(): Promise<Connection> {
  const user = process.env.MYSQL_ADMIN_USER ?? 'root';
  const password = process.env.MYSQL_ADMIN_PASSWORD;
  if (password === undefined) {
    throw new Error('Definí MYSQL_ADMIN_PASSWORD (la contraseña del usuario administrador de MySQL) para correr el setup.');
  }
  return mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user,
    password,
    ssl: config.mysql.ssl,
    multipleStatements: false,
    charset: 'utf8mb4',
    connectTimeout: 15000,
  });
}

export async function runSetup(opts: SetupOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(`  • ${m}`));
  const admin = await openAdmin();
  try {
    const [[ver]] = (await admin.query('SELECT VERSION() AS v')) as unknown as [{ v: string }[]];
    log(`MySQL ${ver.v} en ${config.mysql.host}:${config.mysql.port}`);
    if (/mariadb/i.test(ver.v)) log('Atención: es MariaDB; algunas funciones de MySQL 8 pueden comportarse distinto.');

    // Con el log binario activo (default en MySQL 8), un usuario sin SUPER no puede
    // crear triggers ni funciones a menos que esta opción esté activada.
    try {
      await admin.query('SET PERSIST log_bin_trust_function_creators = 1');
      log('log_bin_trust_function_creators = 1');
    } catch (e) {
      const [[v]] = (await admin.query('SELECT @@log_bin AS lb, @@log_bin_trust_function_creators AS t')) as unknown as [{ lb: number; t: number }[]];
      if (Number(v.lb) === 1 && Number(v.t) !== 1) {
        log(`Atención: no se pudo activar log_bin_trust_function_creators (${(e as Error).message}). Los triggers y funciones pueden fallar con el error 1419; corré "npm run db:check".`);
      }
    }

    // 1. Base de la aplicación
    const appDb = config.app.database;
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${appDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.query(`USE \`${appDb}\``);
    const migrated = await migrateAppSchema(admin, appDb);
    log(`Base de la app ${appDb} lista${migrated.length ? ` (migraciones: ${migrated.join('; ')})` : ''}`);

    // 2. Usuarios con permisos mínimos
    const users = [
      { user: config.app.user, password: config.app.password(), grants: [`ALL PRIVILEGES ON \`${appDb}\`.*`] },
      { user: config.reader.user, password: config.reader.password(), grants: [`SELECT, SHOW VIEW ON \`sqlp\\_ds\\_%\`.*`] },
      {
        user: config.sandbox.user,
        password: config.sandbox.password(),
        grants: [
          // control total, pero solo dentro de bases cuyo nombre empiece con sqlp_sbx_
          `ALL PRIVILEGES ON \`sqlp\\_sbx\\_%\`.*`,
          // lectura de las bases originales para poder copiarlas
          `SELECT, SHOW VIEW ON \`sqlp\\_ds\\_%\`.*`,
        ],
      },
    ];
    for (const u of users) {
      for (const host of config.mysql.userHosts) {
        await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 20', [u.user, host, u.password]);
        await admin.query('ALTER USER ?@? IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 20', [u.user, host, u.password]);
        await admin.query('REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?', [u.user, host]);
        for (const g of u.grants) await admin.query(`GRANT ${g} TO ?@?`, [u.user, host]);
      }
      log(`Usuario ${u.user} configurado (${config.mysql.userHosts.join(', ')})`);
    }

    // 3. Datasets
    for (const ds of listDatasets()) {
      const db = datasetDbName(ds.id);
      if (!db.startsWith(DATASET_PREFIX)) throw new Error('nombre de dataset inválido');
      if (Array.isArray(opts.datasets) && opts.datasets.length > 0 && !opts.datasets.includes(ds.id)) continue;
      if (opts.datasets === 'missing') {
        const [exists] = await admin.query<RowDataPacket[]>('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
        if (exists.length > 0) continue;
      }
      const file = datasetScriptPath(ds);
      if (!fs.existsSync(file)) {
        log(`Falta el archivo ${file}; se omite el dataset ${ds.id}`);
        continue;
      }
      const t0 = Date.now();
      await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
      await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
      await admin.query(`USE \`${db}\``);
      const stmts = splitSql(fs.readFileSync(file, 'utf8'));
      for (const s of stmts) {
        // Los dumps suelen traer su propio CREATE DATABASE / USE: se ignoran
        // para que todo quede dentro de sqlp_ds_<id>.
        if (/^(CREATE\s+(DATABASE|SCHEMA)|USE)\b/i.test(s.sql)) continue;
        await admin.query(s.sql);
      }
      log(`Dataset "${ds.name}" cargado en ${db} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}
