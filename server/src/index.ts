import { purgeExpiredSessions } from './auth/auth.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { cleanupOrphanSandboxes, closeSandboxPool } from './db/sandbox.js';
import { loadBuiltInExercises } from './exercises/repository.js';
import { runSetup } from './setup/runSetup.js';

async function main() {
  const exercises = loadBuiltInExercises(); // falla temprano si algún JSON es inválido

  // En la nube (Render) no hay terminal para correr "npm run db:setup": con AUTO_SETUP=1
  // el servidor crea/migra las tablas y usuarios al arrancar, y carga los datasets que falten.
  if (config.autoSetup) {
    console.log('AUTO_SETUP: preparando MySQL…');
    await runSetup({ datasets: 'missing', log: (m) => console.log(`  • ${m}`) });
  }

  try {
    const n = await cleanupOrphanSandboxes();
    if (n > 0) console.log(`Se borraron ${n} sandbox(es) huérfanos.`);
  } catch (e) {
    console.warn('No se pudo conectar a MySQL con el usuario sandbox:', (e as Error).message);
    console.warn('¿Corriste "npm run db:setup"?');
  }

  // Tareas periódicas: sandboxes sueltos y sesiones vencidas.
  setInterval(() => {
    cleanupOrphanSandboxes().catch(() => {});
    purgeExpiredSessions().catch(() => {});
  }, 10 * 60 * 1000).unref();

  // Al cerrar (Ctrl+C o un reinicio de Render) se borran las copias precalentadas.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      closeSandboxPool().finally(() => process.exit(0));
    });
  }

  // En la PC escucha solo en 127.0.0.1 (no queda expuesta a la red); en Render, en 0.0.0.0.
  createApp().listen(config.port, config.host, () => {
    console.log(`Servidor listo en http://${config.host}:${config.port} (${exercises.length} ejercicios)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
