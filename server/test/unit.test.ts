// Pruebas unitarias: no necesitan MySQL.
import { describe, expect, it } from 'vitest';
import { compareResults } from '../src/grading/compare.js';
import { checkStatements } from '../src/sql/guard.js';
import { splitSql } from '../src/sql/splitter.js';

describe('splitSql', () => {
  it('separa por punto y coma respetando strings y comentarios', () => {
    const s = splitSql("SELECT 'a;b';\n-- uno; dos\nSELECT 2; # x;\n/* ; */ SELECT 3");
    // los comentarios previos quedan pegados a la sentencia siguiente
    expect(s.map((x) => x.sql)).toEqual(["SELECT 'a;b'", '-- uno; dos\nSELECT 2', '# x;\n/* ; */ SELECT 3']);
  });

  it('entiende DELIMITER para triggers y procedimientos', () => {
    const s = splitSql('DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END $$\nDELIMITER ;\nCALL p();');
    expect(s).toHaveLength(2);
    expect(s[0].sql).toBe('CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END');
    expect(s[1]).toEqual({ sql: 'CALL p()', line: 4 });
  });

  it('ignora sentencias vacías o solo comentarios', () => {
    expect(splitSql(';;  -- nada\n')).toEqual([]);
  });

  it('maneja comillas escapadas', () => {
    expect(splitSql("SELECT 'it''s; ok', 'a\\';b'; SELECT 1")).toHaveLength(2);
  });
});

describe('guard', () => {
  const blocked = [
    "GRANT ALL ON *.* TO 'x'@'%'",
    'DROP DATABASE sqlp_ds_universidad',
    'CREATE USER x',
    "SELECT * FROM alumnos INTO OUTFILE '/tmp/x'",
    'SET GLOBAL max_connections = 1',
    'USE mysql',
    "LOAD DATA INFILE 'x' INTO TABLE t",
    'SHUTDOWN',
  ];
  it.each(blocked)('bloquea: %s', (sql) => {
    expect(() => checkStatements(splitSql(sql), 'sandbox')).toThrow();
  });

  it('no confunde palabras dentro de strings', () => {
    expect(() => checkStatements(splitSql("SELECT 'GRANT ALL' AS texto"), 'readonly')).not.toThrow();
  });

  it('en modo solo lectura rechaza DML', () => {
    expect(() => checkStatements(splitSql('DELETE FROM alumnos'), 'readonly')).toThrow(/solo lectura/);
    expect(() => checkStatements(splitSql('WITH x AS (SELECT 1) SELECT * FROM x'), 'readonly')).not.toThrow();
  });

  it('permite DECLARE ... HANDLER dentro de procedimientos', () => {
    const sql = 'DELIMITER //\nCREATE PROCEDURE p() BEGIN DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END; START TRANSACTION; COMMIT; END //\nDELIMITER ;';
    expect(() => checkStatements(splitSql(sql), 'sandbox')).not.toThrow();
  });
});

describe('compareResults', () => {
  const exp = { columns: ['id', 'nombre', 'prom'], rows: [[1, 'Ana', '7.50'], [2, 'Luis', '6.00'], [3, 'Eva', '6.00']] };
  const opts = { orderMatters: false, checkColumnNames: false, numericTolerance: 0.01 };

  it('acepta otro orden de filas, otros alias y números equivalentes', () => {
    const user = { columns: ['a', 'b', 'c'], rows: [[3, 'Eva', 6], [1, 'Ana', 7.5], [2, 'Luis', '6']] };
    expect(compareResults(user, exp, opts).equal).toBe(true);
  });

  it('acepta columnas permutadas con advertencia', () => {
    const user = { columns: ['nombre', 'id', 'prom'], rows: [['Ana', 1, '7.50'], ['Luis', 2, '6.00'], ['Eva', 3, '6.00']] };
    const r = compareResults(user, exp, opts);
    expect(r.equal).toBe(true);
    expect(r.warnings.length).toBe(1);
  });

  it('detecta filas faltantes', () => {
    const r = compareResults({ columns: exp.columns, rows: exp.rows.slice(0, 2) }, exp, opts);
    expect(r.equal).toBe(false);
    expect(r.feedback.join(' ')).toMatch(/Faltan filas/);
  });

  it('distingue NULL de texto vacío y de 0', () => {
    const e = { columns: ['x'], rows: [[null]] };
    expect(compareResults({ columns: ['x'], rows: [[0]] }, e, opts).equal).toBe(false);
    expect(compareResults({ columns: ['x'], rows: [['']] }, e, opts).equal).toBe(false);
  });

  it('verifica el orden solo por las columnas clave (tolera empates)', () => {
    const o = { ...opts, orderMatters: true, orderKeys: [2] };
    const sortedByProm = { columns: exp.columns, rows: [[3, 'Eva', '6.00'], [2, 'Luis', '6.00'], [1, 'Ana', '7.50']] };
    const expAsc = { columns: exp.columns, rows: [[2, 'Luis', '6.00'], [3, 'Eva', '6.00'], [1, 'Ana', '7.50']] };
    expect(compareResults(sortedByProm, expAsc, o).equal).toBe(true);
    expect(compareResults(exp, expAsc, o).equal).toBe(false);
  });

  it('exige alias si el ejercicio lo pide', () => {
    const user = { columns: ['id', 'nom', 'prom'], rows: exp.rows };
    expect(compareResults(user, exp, { ...opts, checkColumnNames: true }).equal).toBe(false);
  });
});
