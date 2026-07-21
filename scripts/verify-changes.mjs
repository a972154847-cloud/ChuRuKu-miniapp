#!/usr/bin/env node
/**
 * verify-changes.mjs
 * 
 * 编辑后验证脚本 — 将变更验证从隐式记忆变为显式执行
 * 
 * 功能：
 * 1. 接收变更的文件路径作为参数
 * 2. 根据文件映射规则找到相关测试
 * 3. 执行测试并记录结果
 * 4. 输出结构化验证报告到 verification-log.json
 * 
 * 用法：
 *   node scripts/verify-changes.mjs <file1> <file2> ...
 *   node scripts/verify-changes.mjs --all          # 运行全部测试
 *   node scripts/verify-changes.mjs --backend      # 仅后端测试
 *   node scripts/verify-changes.mjs --frontend     # 仅前端测试
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, relative, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOG_DIR = resolve(ROOT, '.verification');
const LOG_FILE = resolve(LOG_DIR, 'verification-log.json');

// ─── 文件到测试的映射规则 ─────────────────────────────────────────────────────

/**
 * 后端源文件 → 相关测试文件
 * 基于命名约定和模块职责
 */
const BACKEND_TEST_MAP = {
  // 服务层映射
  'src/services/ai.service.ts': ['tests/ai.service.test.ts', 'tests/ai.chat.test.ts'],
  'src/services/ai-tools.service.ts': ['tests/ai-tools.service.test.ts'],
  'src/services/auth.service.ts': ['tests/auth.login.test.ts', 'tests/test_auth.test.ts'],
  'src/services/equipment.service.ts': ['tests/equipment.service.test.ts', 'tests/test_equipments.test.ts'],
  'src/services/record.service.ts': ['tests/test_records.test.ts', 'tests/test_records_list.test.ts', 'tests/records.insufficient-stock.test.ts'],
  'src/services/category.service.ts': ['tests/test_categories.test.ts', 'tests/categories.delete-force.test.ts'],
  'src/services/log.service.ts': ['tests/log.service.test.ts', 'tests/test_logs.test.ts'],
  'src/services/notification.service.ts': ['tests/notification.service.test.ts', 'tests/test_notification.test.ts'],
  'src/services/embedding.service.ts': ['tests/embedding.service.test.ts'],
  'src/services/llm.service.ts': ['tests/llm.service.test.ts'],
  'src/services/upload.service.ts': ['tests/upload.multiple.test.ts', 'tests/records.photos.test.ts', 'tests/records.photos-delete.test.ts'],
  'src/services/user.service.ts': ['tests/users.get.test.ts', 'tests/users.profile.test.ts'],
  'src/services/dashboard.service.ts': ['tests/test_dashboard.test.ts'],
  'src/services/web-search.service.ts': ['tests/web-search.test.ts'],
  // 中间件映射
  'src/middlewares/auth.middleware.ts': ['tests/test_auth.ts', 'tests/auth.login.test.ts', 'tests/security.owasp.test.ts'],
  'src/middlewares/error.middleware.ts': ['tests/security.owasp.test.ts'],
  'src/middlewares/rate-limit.middleware.ts': ['tests/security.owasp.test.ts'],
  // 路由映射
  'src/routes/ai.ts': ['tests/ai.chat.test.ts', 'tests/ai.parse-record.test.ts', 'tests/test_ai.test.ts'],
  'src/routes/auth.ts': ['tests/auth.login.test.ts', 'tests/test_auth.test.ts'],
  'src/routes/equipment.ts': ['tests/test_equipments.test.ts', 'tests/equipment.service.test.ts'],
  'src/routes/record.ts': ['tests/test_records.test.ts', 'tests/test_records_list.test.ts'],
  'src/routes/category.ts': ['tests/test_categories.test.ts'],
  'src/routes/dashboard.ts': ['tests/test_dashboard.test.ts'],
  'src/routes/user.ts': ['tests/users.get.test.ts', 'tests/users.profile.test.ts'],
  // 通用
  'src/app.ts': ['tests/health.test.ts', 'tests/security.owasp.test.ts'],
  'src/server.ts': ['tests/health.test.ts'],
};

/**
 * 前端源文件 → 相关测试文件
 */
const FRONTEND_TEST_MAP = {
  'src/components/CategoryPicker': ['src/components/__tests__/CategoryPicker.test.tsx'],
  'src/components/EquipmentPicker': ['src/components/__tests__/EquipmentPicker.test.tsx'],
  'src/pages/record-edit': ['src/pages/__tests__/record-edit.test.tsx'],
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function getTimestamp() {
  return new Date().toISOString();
}

function loadLog() {
  if (existsSync(LOG_FILE)) {
    try {
      return JSON.parse(readFileSync(LOG_FILE, 'utf-8'));
    } catch {
      return { runs: [] };
    }
  }
  return { runs: [] };
}

function saveLog(log) {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
}

/**
 * 根据变更文件解析需要运行的测试
 */
function resolveTests(changedFiles) {
  const backendTests = new Set();
  const frontendTests = new Set();
  let runAllBackend = false;
  let runAllFrontend = false;

  for (const file of changedFiles) {
    const relPath = relative(ROOT, resolve(ROOT, file)).replace(/\\/g, '/');
    
    if (relPath.startsWith('backend/')) {
      const srcPath = relPath.replace('backend/', '');
      
      // 精确匹配
      if (BACKEND_TEST_MAP[srcPath]) {
        BACKEND_TEST_MAP[srcPath].forEach(t => backendTests.add(t));
      }
      // 目录级匹配：如果改了 services/ 下未映射的文件，跑全部 service 测试
      else if (srcPath.startsWith('src/services/') || srcPath.startsWith('src/routes/') || srcPath.startsWith('src/middlewares/')) {
        runAllBackend = true;
      }
      // 测试文件本身变更
      else if (srcPath.startsWith('tests/')) {
        backendTests.add(srcPath);
      }
      // 其他后端文件变更，跑健康检查
      else {
        backendTests.add('tests/health.test.ts');
      }
    }
    else if (relPath.startsWith('frontend/')) {
      const srcPath = relPath.replace('frontend/', '');
      
      // 精确匹配或前缀匹配
      let matched = false;
      for (const [pattern, tests] of Object.entries(FRONTEND_TEST_MAP)) {
        if (srcPath.startsWith(pattern)) {
          tests.forEach(t => frontendTests.add(t));
          matched = true;
        }
      }
      
      // 前端测试文件本身变更
      if (!matched && srcPath.includes('__tests__')) {
        frontendTests.add(srcPath);
      }
      // 其他前端源文件变更，运行全部前端测试
      else if (!matched && srcPath.startsWith('src/')) {
        runAllFrontend = true;
      }
    }
  }

  return {
    backend: { tests: [...backendTests], runAll: runAllBackend },
    frontend: { tests: [...frontendTests], runAll: runAllFrontend },
  };
}

/**
 * 执行测试命令
 */
function runTest(command, cwd) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { passed: true, output, error: null };
  } catch (err) {
    return {
      passed: false,
      output: err.stdout || '',
      error: err.stderr || err.message,
    };
  }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  verify-changes — 编辑后验证脚本                             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  用法:                                                       ║
║    node scripts/verify-changes.mjs <file1> <file2> ...       ║
║    node scripts/verify-changes.mjs --all                     ║
║    node scripts/verify-changes.mjs --backend                 ║
║    node scripts/verify-changes.mjs --frontend                ║
║                                                              ║
║  示例:                                                       ║
║    node scripts/verify-changes.mjs backend/src/services/     ║
║      ai.service.ts                                           ║
║    node scripts/verify-changes.mjs frontend/src/components/  ║
║      CategoryPicker.tsx                                      ║
║                                                              ║
║  结果记录到: .verification/verification-log.json             ║
╚══════════════════════════════════════════════════════════════╝
`);
    process.exit(0);
  }

  const timestamp = getTimestamp();
  let testPlan = { backend: { tests: [], runAll: false }, frontend: { tests: [], runAll: false } };
  let mode = 'selective';

  // 解析参数
  if (args.includes('--all')) {
    mode = 'all';
    testPlan.backend.runAll = true;
    testPlan.frontend.runAll = true;
  } else if (args.includes('--backend')) {
    mode = 'backend';
    testPlan.backend.runAll = true;
  } else if (args.includes('--frontend')) {
    mode = 'frontend';
    testPlan.frontend.runAll = true;
  } else {
    testPlan = resolveTests(args);
  }

  console.log(`\n🔍 验证开始 [${timestamp}]`);
  console.log(`   模式: ${mode}`);
  if (args.length > 0 && !args[0].startsWith('--')) {
    console.log(`   变更文件: ${args.join(', ')}`);
  }
  console.log('');

  const results = [];

  // ─── 后端测试 ────────────────────────────────────────────────────────────

  if (testPlan.backend.runAll || testPlan.backend.tests.length > 0) {
    const backendDir = resolve(ROOT, 'backend');
    let cmd;
    
    if (testPlan.backend.runAll) {
      cmd = 'npx jest --forceExit --detectOpenHandles';
      console.log('📦 运行后端全部测试...');
    } else {
      const testPaths = testPlan.backend.tests.map(t => `tests/${basename(t)}`).join(' ');
      cmd = `npx jest ${testPaths} --forceExit --detectOpenHandles`;
      console.log(`📦 运行后端测试: ${testPlan.backend.tests.join(', ')}`);
    }

    const result = runTest(cmd, backendDir);
    results.push({
      scope: 'backend',
      command: cmd,
      passed: result.passed,
      output: result.output?.slice(-500) || '',
      error: result.error?.slice(-500) || null,
      timestamp,
    });

    console.log(result.passed ? '   ✅ 后端测试通过' : '   ❌ 后端测试失败');
    if (!result.passed && result.error) {
      console.log(`   错误: ${result.error.slice(0, 200)}`);
    }
  }

  // ─── 前端测试 ────────────────────────────────────────────────────────────

  if (testPlan.frontend.runAll || testPlan.frontend.tests.length > 0) {
    const frontendDir = resolve(ROOT, 'frontend');
    let cmd;
    
    if (testPlan.frontend.runAll) {
      cmd = 'npx vitest run';
      console.log('📦 运行前端全部测试...');
    } else {
      const testPaths = testPlan.frontend.tests.join(' ');
      cmd = `npx vitest run ${testPaths}`;
      console.log(`📦 运行前端测试: ${testPlan.frontend.tests.join(', ')}`);
    }

    const result = runTest(cmd, frontendDir);
    results.push({
      scope: 'frontend',
      command: cmd,
      passed: result.passed,
      output: result.output?.slice(-500) || '',
      error: result.error?.slice(-500) || null,
      timestamp,
    });

    console.log(result.passed ? '   ✅ 前端测试通过' : '   ❌ 前端测试失败');
    if (!result.passed && result.error) {
      console.log(`   错误: ${result.error.slice(0, 200)}`);
    }
  }

  // ─── 记录结果 ────────────────────────────────────────────────────────────

  const log = loadLog();
  const allPassed = results.every(r => r.passed);
  
  log.runs.push({
    timestamp,
    mode,
    changedFiles: args.filter(a => !a.startsWith('--')),
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      allPassed,
    },
  });

  // 只保留最近 100 条记录
  if (log.runs.length > 100) {
    log.runs = log.runs.slice(-100);
  }

  saveLog(log);

  // ─── 输出总结 ────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log(`📋 验证结果: ${allPassed ? '✅ 全部通过' : '❌ 存在失败'}`);
  console.log(`   通过: ${results.filter(r => r.passed).length}/${results.length}`);
  console.log(`   记录: ${LOG_FILE}`);
  console.log('═'.repeat(60) + '\n');

  process.exit(allPassed ? 0 : 1);
}

main();
