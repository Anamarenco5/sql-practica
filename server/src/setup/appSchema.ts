// Tablas de la base sqlpractica_app: usuarios, sesiones, progreso y ejercicios propios.
// El setup se puede correr muchas veces: crea lo que falta y migra versiones anteriores
// sin perder datos.
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { splitSql } from '../sql/splitter.js';

export const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario  INT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(190) NOT NULL,
  nombre      VARCHAR(80)  NOT NULL,
  hash_clave  VARCHAR(255) NOT NULL,
  es_admin    BOOLEAN      NOT NULL DEFAULT FALSE,
  creado      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_usuarios_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  CHAR(64)  PRIMARY KEY,
  id_usuario  INT       NOT NULL,
  creada      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira      DATETIME  NOT NULL,
  INDEX idx_sesiones_usuario (id_usuario),
  CONSTRAINT fk_sesiones_usuarios FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS intentos (
  id_intento    INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario    INT          NULL,
  id_ejercicio  VARCHAR(80)  NOT NULL,
  sql_texto     MEDIUMTEXT   NOT NULL,
  correcto      BOOLEAN      NOT NULL,
  codigo_error  VARCHAR(60)  NULL,
  pistas_vistas INT          NOT NULL DEFAULT 0,
  fecha         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_intentos_usuario (id_usuario, id_ejercicio, fecha)
);

CREATE TABLE IF NOT EXISTS ejercicios_personalizados (
  id_ejercicio VARCHAR(80) PRIMARY KEY,
  id_usuario   INT         NULL,
  publico      BOOLEAN     NOT NULL DEFAULT FALSE,
  definicion   JSON        NOT NULL,
  creado       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ejercicios_usuario (id_usuario)
);

CREATE TABLE IF NOT EXISTS borradores (
  id_usuario   INT         NOT NULL,
  id_ejercicio VARCHAR(80) NOT NULL,
  sql_texto    MEDIUMTEXT  NOT NULL,
  actualizado  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_ejercicio)
);
`;

async function hasColumn(conn: Connection, db: string, table: string, column: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [db, table, column],
  );
  return rows.length > 0;
}

/** Crea las tablas y migra las de la versión de un solo usuario (etapas 1 a 5). */
export async function migrateAppSchema(conn: Connection, db: string): Promise<string[]> {
  const done: string[] = [];
  // Versión anterior: borradores sin usuario. Son descartables, se recrea la tabla.
  const [old] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'borradores'",
    [db],
  );
  if (old.length > 0 && !(await hasColumn(conn, db, 'borradores', 'id_usuario'))) {
    await conn.query('DROP TABLE borradores');
    done.push('borradores: recreada con id_usuario');
  }
  for (const stmt of splitSql(APP_SCHEMA)) await conn.query(stmt.sql);
  if (!(await hasColumn(conn, db, 'intentos', 'id_usuario'))) {
    await conn.query('ALTER TABLE intentos ADD id_usuario INT NULL AFTER id_intento, ADD INDEX idx_intentos_usuario (id_usuario, id_ejercicio, fecha)');
    done.push('intentos: agregada id_usuario');
  }
  if (!(await hasColumn(conn, db, 'ejercicios_personalizados', 'id_usuario'))) {
    await conn.query('ALTER TABLE ejercicios_personalizados ADD id_usuario INT NULL AFTER id_ejercicio, ADD publico BOOLEAN NOT NULL DEFAULT FALSE AFTER id_usuario, ADD INDEX idx_ejercicios_usuario (id_usuario)');
    done.push('ejercicios_personalizados: agregadas id_usuario y publico');
  }
  return done;
}
