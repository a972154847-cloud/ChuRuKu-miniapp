import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 测试配置
 * - webServer 启动 Taro H5 dev server（webpack，首次编译较慢，timeout 240s）
 * - baseURL: http://localhost:10086（Taro 4.2 H5 默认端口）
 * - 单线程串行：避免 dev server 并发问题
 * - page.route mock 后端 API（http://localhost:3000/api/**），不启动真实后端
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:10087',
    trace: 'on-first-retry',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:h5',
    url: 'http://localhost:10087',
    timeout: 240_000,
    reuseExistingServer: true,
    cwd: __dirname,
  },
})
