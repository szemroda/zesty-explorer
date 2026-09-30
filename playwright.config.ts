import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: {
    // Tests run against the CLI that npm users get, never a reused dev server.
    command: 'pnpm build && node build/cli/index.js --no-open',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium-laptop',
      testIgnore: '**/performance.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'chromium-desktop',
      testIgnore: '**/performance.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
    // Runs after the functional projects so parallel workers do not skew timings. CI skips it.
    {
      name: 'chromium-performance',
      testMatch: '**/performance.spec.ts',
      dependencies: ['chromium-laptop', 'chromium-desktop'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
  ],
});
