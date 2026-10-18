// Configuración del backend. Todo sale de variables de entorno (server/.env),
// nunca del código ni del frontend.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/.env, sin importar desde qué carpeta se ejecute el proceso
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Falta la variable de entorno ${name}. Copiá server/.env.example a server/.env y completala.`);
  }
  return v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  return v ? Number(v) : def;
}

const production = process.env.NODE_ENV === 'production';

/** Certificado de la CA para conectarse por SSL (Aiven lo exige). Admite "\n" escritos como texto. */
function sslConfig() {
  const ca = process.env.MYSQL_SSL_CA?.replace(/\\n/g, '\n');
  if (ca) return { ca, rejectUnauthorized: true };
  if (process.env.MYSQL_SSL === 'required') return { rejectUnauthorized: true };
  return undefined;
}

export const config = {
  production,
  port: num('PORT', 3001),
  // En la PC: solo 127.0.0.1. En Render hay que escuchar en 0.0.0.0.
  host: process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
  // Dirección pública (ej: https://sql-practica.onrender.com). Se acepta como Host/Origin válido.
  publicOrigin: process.env.PUBLIC_ORIGIN ?? '',
  // Render pone un proxy delante: hace falta para conocer la IP real (límite de pedidos).
  trustProxy: process.env.TRUST_PROXY === '1' || production,
  // Emails que tienen permisos de administradora (pueden publicar ejercicios para todos).
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: num('MYSQL_PORT', 3306),
    ssl: sslConfig(),
    // Desde qué host se conectan los usuarios de la app: en la PC, localhost; en la nube, '%'.
    userHosts: (process.env.MYSQL_USER_HOSTS ?? 'localhost,127.0.0.1').split(',').map((s) => s.trim()).filter(Boolean),
    appPoolSize: num('APP_POOL_SIZE', 5),
  },
  // Usuario de la app: solo puede tocar la base de progreso (sqlpractica_app).
  app: {
    user: process.env.APP_DB_USER ?? 'sqlp_app',
    password: () => required('APP_DB_PASSWORD'),
    database: process.env.APP_DB_NAME ?? 'sqlpractica_app',
  },
  // Usuario lector: solo SELECT sobre las bases de datos de práctica (sqlp_ds_*).
  reader: {
    user: process.env.READER_DB_USER ?? 'sqlp_reader',
    password: () => required('READER_DB_PASSWORD'),
  },
  // Usuario sandbox: control total pero SOLO dentro de bases temporales sqlp_sbx_*.
  sandbox: {
    user: process.env.SANDBOX_DB_USER ?? 'sqlp_sandbox',
    password: () => required('SANDBOX_DB_PASSWORD'),
  },
  limits: {
    timeoutMs: num('QUERY_TIMEOUT_MS', 5000),
    maxRows: num('MAX_ROWS', 10000), // filas leídas como máximo por resultado
    displayRows: num('DISPLAY_ROWS', 500), // filas enviadas al navegador
    maxSqlLength: num('MAX_SQL_LENGTH', 20000),
    maxStatements: num('MAX_STATEMENTS', 30),
    sandboxPool: num('SANDBOX_POOL', 2), // copias de la base preparadas de antemano (0 = desactivado)
    parallelEnvs: num('MAX_PARALLEL_ENVS', 8), // entornos simultáneos por usuario de MySQL
    runsPerMinute: num('RUNS_PER_MINUTE', 40), // ejecuciones por persona y por minuto
    authPerMinute: num('AUTH_PER_MINUTE', 10), // intentos de login/registro por IP y por minuto
  },
  auth: {
    sessionDays: num('SESSION_DAYS', 30),
  },
  // Si están definidos, el servidor completa el setup solo al arrancar (útil en Render).
  autoSetup: process.env.AUTO_SETUP === '1',
  paths: {
    client: path.resolve(here, '../../client/dist'),
    datasets: path.resolve(here, '../../db/datasets'),
    exercises: path.resolve(here, '../exercises'), // JSON de ejercicios de fábrica
  },
};

// Prefijos de nombres de base: el aislamiento depende de estos patrones en los GRANT.
export const DATASET_PREFIX = 'sqlp_ds_';
export const SANDBOX_PREFIX = 'sqlp_sbx_';
