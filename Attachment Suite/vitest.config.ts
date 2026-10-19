import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // 仅为 tests/mocks 的真实集成测试提供运行时 Obsidian mock；
      // 其它单元测试不 import 'obsidian'，不受影响。
      obsidian: fileURLToPath(new URL('./tests/mocks/obsidian-stub.ts', import.meta.url)),
    },
  },
});