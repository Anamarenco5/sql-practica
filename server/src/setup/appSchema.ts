// Tablas de la base sqlpractica_app (progreso y ejercicios personalizados).
// Se usan CREATE TABLE IF NOT EXISTS para que el setup se pueda correr varias veces
// sin perder tu progreso.
export const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS intentos (
  id_intento   INT AUTO_INCREMENT PRIMARY KEY,
  id_ejercicio VARCHAR(80)  NOT NULL,
  sql_texto    MEDIUMTEXT   NOT NULL,
  correcto     BOOLEAN      NOT NULL,
  codigo_error VARCHAR(60)  NULL,
  pistas_vistas INT         NOT NULL DEFAULT 0,
  fecha        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_intentos_ejercicio (id_ejercicio, fecha)
);

CREATE TABLE IF NOT EXISTS ejercicios_personalizados (
  id_ejercicio VARCHAR(80) PRIMARY KEY,
  definicion   JSON        NOT NULL,
  creado       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS borradores (
  id_ejercicio VARCHAR(80) PRIMARY KEY,
  sql_texto    MEDIUMTEXT  NOT NULL,
  actualizado  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;
