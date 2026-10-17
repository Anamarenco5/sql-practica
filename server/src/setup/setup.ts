// npm run db:setup
// Se corre UNA vez (y cada vez que agregues un dataset). Usa el usuario
// administrador (root) SOLO durante el setup; la app después nunca lo usa.
//   1. Crea la base de progreso sqlpractica_app y sus tablas.
//   2. Crea los usuarios sqlp_app, sqlp_reader y sqlp_sandbox con permisos mínimos.
//   3. Carga cada dataset de db/datasets/ como sqlp_ds_<id>.
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { config, DATASET_PREFIX } from '../config.js';
import { datasetDbName, datasetScriptPath, listDatasets } from '../db/datasets.js';
import { splitSql } from '../sql/splitter.js';
import { APP_SCHEMA } from './appSchema.js';

const HOSTS = ['localhost', '127.0.0.1']; // según el sistema, MySQL ve la conexión local con uno u otro

function log(msg: string) {
  console.log(`  • ${msg}`);
}

async function main() {
  const adminUser = process.env.MYSQL_ADMIN_USER ?? 'root';
  const adminPassword = process.env.MYSQL_ADMIN_PASSWORD;
  if (adminPassword === undefined) {
    throw new Error('Definí MYSQL_ADMIN_PASSWORD en server/.env (la contraseña de root de tu MySQL) para correr el setup.');
  }
  const only = process.argv.slice(2); // opcional: ids de datasets a recargar

  console.log(`\nConectando a MySQL en ${config.mysql.host}:${config.mysql.port} como ${adminUser}…`);
  const admin = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: adminUser,
    password: adminPassword,
    multipleStatements: false,
    charset: 'utf8mb4',
  });
  const [[ver]] = (await admin.query('SELECT VERSION() AS v')) as unknown as [{ v: string }[]];
  log(`MySQL ${ver.v}`);
  if (/mariadb/i.test(ver.v)) console.warn('  ! Estás usando MariaDB: algunas funciones de MySQL 8 pueden comportarse distinto.');

  // Con el log binario activo (default en MySQL 8), un usuario sin SUPER no puede
  // crear triggers ni funciones a menos que se active esta opción.
  try {
    await admin.query('SET PERSIST log_bin_trust_function_creators = 1');
    log('log_bin_trust_function_creators = 1 (permite crear triggers y funciones en los sandbox)');
  } catch (e) {
    console.warn(`  ! No se pudo activar log_bin_trust_function_creators: ${(e as Error).message}`);
  }

  // 1. Base de la aplicación
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.app.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.query(`USE \`${config.app.database}\``);
  for (const stmt of splitSql(APP_SCHEMA)) await admin.query(stmt.sql);
  log(`Base de progreso ${config.app.database} lista`);

  // 2. Usuarios con permisos mínimos
  const users = [
    { user: config.app.user, password: config.app.password(), grants: [`ALL PRIVILEGES ON \`${config.app.database}\`.*`] },
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
    for (const host of HOSTS) {
      await admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 20`, [u.user, host, u.password]);
      await admin.query(`ALTER USER ?@? IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 20`, [u.user, host, u.password]);
      await admin.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?`, [u.user, host]);
      for (const g of u.grants) await admin.query(`GRANT ${g} TO ?@?`, [u.user, host]);
    }
    log(`Usuario ${u.user} configurado`);
  }

  // 3. Datasets
  for (const ds of listDatasets()) {
    if (only.length > 0 && !only.includes(ds.id)) continue;
    const db = datasetDbName(ds.id);
    if (!db.startsWith(DATASET_PREFIX)) throw new Error('nombre de dataset inválido');
    const file = datasetScriptPath(ds);
    if (!fs.existsSync(file)) {
      console.warn(`  ! Falta el archivo ${file}; se omite el dataset ${ds.id}`);
      continue;
    }
    const t0 = Date.now();
    await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.query(`USE \`${db}\``);
    const stmts = splitSql(fs.readFileSync(file, 'utf8'));
    for (const s of stmts) {
      // Los dumps suelen traer su propio CREATE DATABASE / USE: los ignoramos
      // para que todo quede dentro de sqlp_ds_<id>.
      if (/^(CREATE\s+(DATABASE|SCHEMA)|USE)\b/i.test(s.sql)) continue;
      await admin.query(s.sql);
    }
    log(`Dataset "${ds.name}" cargado en ${db} (${stmts.length} sentencias, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }

  await admin.end();
  console.log('\nListo. Ahora podés correr: npm run dev\n');
}

main().catch((e) => {
  console.error('\nError en el setup:', e.message);
  if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('Revisá MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD en server/.env');
  if (e.code === 'ECONNREFUSED') console.error('¿Está iniciado el servicio MySQL80? (Servicios de Windows o MySQL Workbench)');
  process.exit(1);
});
