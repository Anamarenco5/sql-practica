import { createApp } from './app.js';
import { config } from './config.js';
import { cleanupOrphanSandboxes } from './db/sandbox.js';
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
  // Solo escucha en localhost: la API no queda expuesta a la red.
  createApp().listen(config.port, '127.0.0.1', () => {
    console.log(`API lista en http://127.0.0.1:${config.port} (${exercises.length} ejercicios)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
