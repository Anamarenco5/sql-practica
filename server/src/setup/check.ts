// npm run db:check
// Verifica que el MySQL configurado permita todo lo que necesitan los ejercicios:
// crear bases temporales, tablas, triggers, procedimientos y funciones con el usuario
// sandbox (sin privilegios de administrador). Útil antes de publicar en la nube.
import { closePools, openConnection } from '../db/connections.js';
import { closeSandboxPool, createSandbox } from '../db/sandbox.js';

const pasos: [string, string][] = [
  ['crear una tabla', 'CREATE TABLE prueba_check (id INT PRIMARY KEY, n INT)'],
  ['crear un trigger', 'CREATE TRIGGER trg_check BEFORE INSERT ON prueba_check FOR EACH ROW SET NEW.n = 1'],
  ['crear un procedimiento', 'CREATE PROCEDURE sp_check() BEGIN SELECT 1; END'],
  ['crear una función', 'CREATE FUNCTION fn_check() RETURNS INT DETERMINISTIC RETURN 1'],
  ['usar una transacción', 'START TRANSACTION'],
  ['confirmarla', 'COMMIT'],
  ['agregar un CHECK', 'ALTER TABLE prueba_check ADD CONSTRAINT chk_check CHECK (n >= 0)'],
];

async function main() {
  let ok = true;
  const r = await openConnection('reader');
  const [[v]] = (await r.query('SELECT VERSION() AS v, @@log_bin AS lb, @@log_bin_trust_function_creators AS t, @@sql_require_primary_key AS pk')) as unknown as [Record<string, unknown>[]];
  await r.end();
  console.log(`MySQL ${v.v}  log_bin=${v.lb}  log_bin_trust_function_creators=${v.t}  sql_require_primary_key=${v.pk}`);
  const t0 = Date.now();
  const sbx = await createSandbox('universidad');
  console.log(`✓ copiar la base Universidad a un sandbox (${Date.now() - t0} ms)`);
  try {
    for (const [nombre, sql] of pasos) {
      try {
        await sbx.conn.query(sql); // cada paso es una sola sentencia (sin DELIMITER)
        console.log(`✓ ${nombre}`);
      } catch (e) {
        ok = false;
        console.log(`✗ ${nombre}: ${(e as Error).message}`);
      }
    }
  } finally {
    await sbx.dispose();
    await closeSandboxPool();
    await closePools();
  }
  console.log(ok ? '\nTodo funciona: este MySQL sirve para la app.' : '\nHay pasos que fallan: los ejercicios que los usan no van a poder corregirse.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
