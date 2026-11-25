import { configDefaults, defineConfig } from 'vitest/config';

// Tests live in src/. Skip local git worktrees (each is a full copy of the repo).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
