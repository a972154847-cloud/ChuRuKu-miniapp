import type { UserConfigExport } from "@tarojs/cli"

export default {
  mini: {
    optimizeMainPackage: {
      enable: true
    }
  },
  h5: {}
} satisfies UserConfigExport<'webpack5'>
