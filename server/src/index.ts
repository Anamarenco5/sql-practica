import { createApp } from './app.js';
import { config } from './config.js';
import { cleanupOrphanSandboxes, closeSandboxPool } from './db/sandbox.js';
import { loadBuiltInExercises } from './exercises/repository.js';

async function main() {
  const exercises = loadBuiltInExercises(); // falla temprano si algún JSON es inválido
  try {
    const n = await cleanupOrphanSandboxes();
    if (n > 0) console.log(`Se borraron ${n} sandbox(es) huérfanos.`);
  } catch (e) {
    console.warn('No se pudo conectar a MySQL con el usuario sandbox:', (e as Error).message);
    console.warn('¿Corriste "npm run db:setup"?');
  }
  // Red de seguridad: cada 10 minutos se borran sandboxes que hayan quedado sueltos.
  setInterval(() => {
    cleanupOrphanSandboxes().catch(() => {});
  }, 10 * 60 * 1000).unref();
  // Al cerrar (Ctrl+C) se borran las copias precalentadas.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      closeSandboxPool().finally(() => process.exit(0));
    });
  }
  // Solo escucha en localhost: la API no queda expuesta a la red.
  createApp().listen(config.port, '127.0.0.1', () => {
    console.log(`API lista en http://127.0.0.1:${config.port} (${exercises.length} ejercicios)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
