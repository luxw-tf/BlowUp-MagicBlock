import { defineConfig } from 'vitest/config';

// Tests live in src/ only (so local copies of the repo in subfolders are never picked up).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
