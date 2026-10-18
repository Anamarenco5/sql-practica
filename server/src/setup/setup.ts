// npm run db:setup  [ids de datasets a recargar]
// Se corre una vez (y cada vez que cambie un dataset o la estructura de la app).
import { config } from '../config.js';
import { runSetup } from './runSetup.js';

const only = process.argv.slice(2);
console.log(`\nConectando a MySQL en ${config.mysql.host}:${config.mysql.port}…`);
runSetup({ datasets: only.length > 0 ? only : 'all' })
  .then(() => {
    console.log('\nListo. Ahora podés correr: npm run dev\n');
    process.exit(0);
  })
  .catch((e) => {
    console.error('\nError en el setup:', e.message);
    if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('Revisá MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD en server/.env');
    if (e.code === 'ECONNREFUSED') console.error('¿Está iniciado el servicio de MySQL? (MySQL80 en Windows, o el servicio en la nube)');
    process.exit(1);
  });
