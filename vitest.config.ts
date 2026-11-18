import { defineConfig } from 'vitest/config';

// Sin este fichero vitest usa sus patrones por defecto y también recoge
// `dist/**/*.test.js` (el resultado de `npm run build`): en local, tras compilar,
// las pruebas fallaban con "Vitest cannot be imported in a CommonJS module".
// Mismo patrón que restaurant-service / accounting-service / purchasing-service.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
    },
  },
});
