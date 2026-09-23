import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: { headless: true, viewport: { width: 1440, height: 1000 } },
  reporter: 'list',
});
