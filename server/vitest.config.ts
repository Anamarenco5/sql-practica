import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    // Con TRUST_PROXY cada usuario de prueba se registra desde una IP distinta (X-Forwarded-For),
    // así el límite de registros por IP no frena las pruebas.
    env: { TRUST_PROXY: '1' },
    fileParallelism: false,
  },
});
