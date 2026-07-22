#!/usr/bin/env node
/**
 * scan-secrets.mjs — 密钥扫描工具
 *
 * 功能：
 * - 扫描 git 暂存区（staged）文件中的潜在密钥/凭证
 * - 也支持直接扫描指定文件（传入文件路径参数）
 * - 集成到 lint-staged / pre-commit 管道中
 *
 * 用法：
 *   node scripts/scan-secrets.mjs                # 扫描暂存区
 *   node scripts/scan-secrets.mjs <file1> <file2> # 扫描指定文件
 *   node scripts/scan-secrets.mjs --all           # 扫描整个仓库
 *   node scripts/scan-secrets.mjs --list          # 列出内置模式
 *
 * 退出码：
 *   0 — 未发现密钥
 *   1 — 发现密钥
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── 密钥模式 ─────────────────────────────────────────────────────────────────
//
// 每条规则包含：
//   id        — 唯一标识
//   name      — 人类可读名称
//   patterns  — 正则表达式数组（任一匹配即触发告警）
//   severity  — 'high' | 'medium' | 'low'
//   allowlist — 允许名单（匹配到的行不触发告警）
//
// 设计原则：宁可误报（false positive）不可漏报（false negative）。
// 用户可通过 allowlist 排除已知的测试密钥/示例值。

const SECRET_PATTERNS = [
  // ── 高严重性：明确的私钥 / 令牌 ─────────────────────────────────────────
  {
    id: 'private-key',
    name: '私钥/证书 (Private Key / Certificate)',
    severity: 'high',
    patterns: [
      /-----BEGIN\s+(?:RSA|DSA|EC|PGP|OPENSSH|SSH2)\s+PRIVATE\s+KEY-----/i,
      /-----BEGIN\s+CERTIFICATE-----/i,
      /-----BEGIN\s+PGP\s+(?:PRIVATE\s+)?KEY\s+BLOCK-----/i,
    ],
  },
  {
    id: 'jwt-token',
    name: 'JWT Token (硬编码)',
    severity: 'high',
    patterns: [
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    ],
  },
  {
    id: 'aws-key',
    name: 'AWS Access Key',
    severity: 'high',
    patterns: [
      /(?:AKIA|ASIA)[A-Z0-9]{16}/,
      /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]\s*['"][A-Za-z0-9\/+%=]{20,}['"]/i,
    ],
  },
  {
    id: 'github-token',
    name: 'GitHub Token',
    severity: 'high',
    patterns: [
      /ghp_[A-Za-z0-9]{36}/,
      /gho_[A-Za-z0-9]{36}/,
      /ghu_[A-Za-z0-9]{36}/,
      /ghs_[A-Za-z0-9]{36}/,
      /ghr_[A-Za-z0-9]{36}/,
      /github_pat_[A-Za-z0-9]{22,}/,
    ],
  },
  {
    id: 'slack-token',
    name: 'Slack Token',
    severity: 'high',
    patterns: [
      /xox[baprs]-[A-Za-z0-9-]{20,}/,
    ],
  },

  // ── 中严重性：API Key / 密码字面量 ──────────────────────────────────────
  {
    id: 'generic-api-key',
    name: '通用 API Key (疑似)',
    severity: 'medium',
    patterns: [
      /(?:(?:api|api[_-]?key|token|secret|passwd|password|credential)[\s]*[:=][\s]*['"]?)[A-Za-z0-9_\-\.\/+]{16,}(?:['"]?\s*$|['"][\s;,]*$)/i,
    ],
    allowlist: [
      /JWT_SECRET\s*=\s*[a-f0-9]{64}/i, // 示例/测试密钥
      /EXAMPLE_/i,
      /placeholder/i,
    ],
  },
  {
    id: 'sql-conn-string',
    name: '数据库连接字符串含密码',
    severity: 'medium',
    patterns: [
      /(?:mysql|postgres|mongodb|redis|sqlite|mssql):\/\/(?:[^:]+):(?:[^@]+)@/i,
    ],
  },
  {
    id: 'heroku-api-key',
    name: 'Heroku API Key',
    severity: 'medium',
    patterns: [
      /[hH][eE][rR][oO][kK][uU].*[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/,
    ],
  },
  {
    id: 'google-api-key',
    name: 'Google API Key / OAuth',
    severity: 'medium',
    patterns: [
      /AIza[A-Za-z0-9_\-]{35}/,
      /[0-9]+-[A-Za-z0-9_]{32}\.apps\.googleusercontent\.com/,
    ],
  },
  {
    id: 'twilio-api-key',
    name: 'Twilio API Key',
    severity: 'medium',
    patterns: [
      /SK[A-Za-z0-9]{32}/,
      /AC[A-Za-z0-9]{32}/,
    ],
  },

  // ── 低严重性：密码/密钥赋值（上下文相关） ──────────────────────────────
  {
    id: 'password-assignment',
    name: '密码字面量赋值',
    severity: 'low',
    patterns: [
      /password\s*[:=]\s*['"][A-Za-z0-9!@#$%^&*()_+\-={}[\]:;<>,.?\/\\|]{8,}['"]/i,
    ],
    allowlist: [
      /password\s*[:=]\s*['"]\s*['"]/i, // 空密码
      /placeholder/i,
      /example/i,
    ],
  },
  {
    id: 'npm-token',
    name: 'npm Auth Token',
    severity: 'medium',
    patterns: [
      /\/\/registry\.npmjs\.org\/[:_]authToken[\s]*[:=][\s]*['"][A-Za-z0-9\-]{20,}['"]/i,
      /npm_token\s*[:=]\s*['"][A-Za-z0-9\-]{20,}['"]/i,
    ],
  },
];

// ─── 文件扩展名排除 ───────────────────────────────────────────────────────────

const EXCLUDED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.mp4', '.avi', '.mov', '.webm', '.exe', '.dll', '.so', '.dylib',
  '.o', '.obj', '.pyc', '.class', '.jar', '.war',
]);

// ─── 文件名排除 ───────────────────────────────────────────────────────────────

const EXCLUDED_PATHS = [
  /node_modules[/\\]/,
  /\.git[/\\]/,
  /\.husky[/\\]_[/\\]/,
  /dist[/\\]/,
  /coverage[/\\]/,
  /uploads[/\\]/,
  /\.verification[/\\]/,
  /midscene_run[/\\]/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /composer\.lock$/,
  /\.env\.example$/,
  /\.env\.example\..+$/,
];

// ─── 结果 ─────────────────────────────────────────────────────────────────────

class SecretScanner {
  constructor() {
    this.findings = [];
    this.filesScanned = 0;
    this.filesSkipped = 0;
  }

  /**
   * 获取暂存区文件列表
   */
  getStagedFiles() {
    try {
      const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
      console.error('[scan-secrets] 无法获取暂存区文件（不在 git 仓库中？）');
      return [];
    }
  }

  /**
   * 获取仓库所有文件（--all 模式）
   */
  getAllFiles() {
    try {
      const output = execSync('git ls-files', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
      console.error('[scan-secrets] 无法获取仓库文件列表');
      return [];
    }
  }

  /**
   * 判断文件是否应跳过
   */
  shouldSkip(filePath) {
    const normalized = filePath.replace(/\\/g, '/');

    if (EXCLUDED_PATHS.some(p => p.test(normalized))) return true;

    const ext = normalized.substring(normalized.lastIndexOf('.')).toLowerCase();
    if (EXCLUDED_EXTENSIONS.has(ext)) return true;

    return false;
  }

  /**
   * 检查行是否匹配允许名单
   */
  isAllowed(line, allowlist) {
    if (!allowlist || allowlist.length === 0) return false;
    return allowlist.some(pattern => pattern.test(line));
  }

  /**
   * 扫描文件内容
   */
  scanFile(filePath) {
    const absPath = resolve(ROOT, filePath);

    if (!existsSync(absPath)) {
      this.filesSkipped++;
      return;
    }

    if (this.shouldSkip(filePath)) {
      this.filesSkipped++;
      return;
    }

    let content;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      // 二进制文件等
      this.filesSkipped++;
      return;
    }

    const lines = content.split('\n');
    this.filesScanned++;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      for (const rule of SECRET_PATTERNS) {
        // 检查允许名单
        if (this.isAllowed(line, rule.allowlist)) continue;

        for (const pattern of rule.patterns) {
          if (pattern.test(line)) {
            const match = line.match(pattern);
            const excerpt = match
              ? line.substring(0, Math.min(line.indexOf(match[0]) + 20, line.length)).trim()
              : line.substring(0, 60).trim();

            this.findings.push({
              file: filePath,
              line: lineNum,
              rule: rule.id,
              severity: rule.severity,
              name: rule.name,
              excerpt: excerpt.replace(/['"]/g, "'"),
            });
            break; // 一条线只报告一个规则
          }
        }
      }
    }
  }

  /**
   * 输出结果
   */
  report() {
    if (this.findings.length === 0) {
      console.log(`\n✅ 密钥扫描通过 — 扫描 ${this.filesScanned} 个文件（跳过 ${this.filesSkipped} 个），未发现可疑密钥\n`);
      return true;
    }

    console.log(`\n🔴 密钥扫描发现 ${this.findings.length} 个潜在问题:\n`);

    // 按严重性分组
    const high = this.findings.filter(f => f.severity === 'high');
    const medium = this.findings.filter(f => f.severity === 'medium');
    const low = this.findings.filter(f => f.severity === 'low');

    const sorted = [...high, ...medium, ...low];

    for (const f of sorted) {
      const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🟢';
      console.log(`  ${icon} [${f.severity.toUpperCase()}] ${f.name}`);
      console.log(`     文件: ${f.file}:${f.line}`);
      console.log(`     片段: ${f.excerpt}`);
      console.log('');
    }

    console.log(`   🔴 HIGH:   ${high.length}`);
    console.log(`   🟡 MEDIUM: ${medium.length}`);
    console.log(`   🟢 LOW:    ${low.length}`);
    console.log(`   扫描文件: ${this.filesScanned} | 跳过: ${this.filesSkipped}`);
    console.log('');

    return false;
  }
}

// ─── CLI 入口 ─────────────────────────────────────────────────────────────────

function printPatterns() {
  console.log('\n📋 内置密钥检测模式:\n');
  for (const rule of SECRET_PATTERNS) {
    const icon = rule.severity === 'high' ? '🔴' : rule.severity === 'medium' ? '🟡' : '🟢';
    console.log(`  ${icon} [${rule.severity.toUpperCase()}] ${rule.name} (${rule.id})`);
    if (rule.allowlist) {
      console.log(`     允许名单: ${rule.allowlist.length} 条规则`);
    }
    console.log('');
  }
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    printPatterns();
  }

  const scanner = new SecretScanner();

  let files;

  if (args.includes('--all')) {
    console.log('[scan-secrets] 扫描整个仓库...');
    files = scanner.getAllFiles();
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // 直接扫描指定文件
    files = args;
  } else {
    // 默认：扫描暂存区
    files = scanner.getStagedFiles();
  }

  if (files.length === 0) {
    console.log('[scan-secrets] 没有需要扫描的文件');
    process.exit(0);
  }

  for (const file of files) {
    scanner.scanFile(file);
  }

  const passed = scanner.report();
  process.exit(passed ? 0 : 1);
}

main();
