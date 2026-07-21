// babel-preset-taro 更多选项和默认值：
// https://docs.taro.zone/docs/next/babel-config
//
// 显式注入 optional-chaining / nullish-coalescing 插件：
// Taro 4.2 的 babel-preset-taro 在某些场景下未将 ES2020 可选链（?.）
// 与空值合并（??）语法降级到 ES5/ES6，导致微信小程序真机运行时
// 报 "SyntaxError: Unexpected token ."（invalid file: xxx.js）。
// 这里手动追加 plugin，确保构建产物不再保留 ?./?? 字面量。
//
// 解析方式：用 require.resolve 显式拿绝对路径，避免 babel-loader 字符串名
// 虚拟解析在 pnpm 严格隔离环境下失败（Cannot find package）。
// 降级策略：预览服务器 pnpm prewarm 缓存可能未安装这两个包，
// try-catch 跳过（H5 预览浏览器原生支持 ES2020，不需要降级）；
// 本地/微信小程序构建时插件已安装，正常启用。

const plugins = []

try {
  plugins.push(require.resolve('@babel/plugin-transform-optional-chaining'))
} catch (_) {
  // 预览服务器 pnpm 环境未安装，跳过（H5 预览不需要 ES2020 降级）
}

try {
  plugins.push(require.resolve('@babel/plugin-transform-nullish-coalescing-operator'))
} catch (_) {
  // 预览服务器 pnpm 环境未安装，跳过（H5 预览不需要 ES2020 降级）
}

module.exports = {
  presets: [
    ['taro', {
      framework: 'react',
      ts: true,
      compiler: 'webpack5',
    }]
  ],
  plugins
}
