import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  // P2-5: 启用覆盖率报告
  // - 默认跑 test 时不收集，避免拖慢日常开发
  // - 通过 `pnpm test -- --coverage` 触发收集
  // - 阈值保护：核心模块（权限/AI降级/日志）80%+，全量 70%+
  // - 失败时通过 collectCoverageFrom 白名单控制
  collectCoverageFrom: [
    'src/services/**/*.ts',
    'src/middlewares/**/*.ts',
    'src/routes/**/*.ts',
    'src/utils/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__mocks__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // 阈值仅在 --coverage 模式生效；不强制阻止 npm test
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
    './src/middlewares/': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
    './src/services/log.service.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
    './src/services/ai-tools.service.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },
}

module.exports = config
