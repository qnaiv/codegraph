import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/extension/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
