import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: {
    channel: existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined,
    launchOptions: { timeout: 0 },
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: 'list',
});
