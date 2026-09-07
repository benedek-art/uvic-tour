import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  reporter: [['list']],
  timeout: 45_000,
  use: { baseURL: 'http://localhost:4173', trace: 'off' },
  projects: [{ name: 'iPhone', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
