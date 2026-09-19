// Windows 打包包装脚本
// 用法：node --use-system-ca scripts/package-win.js [--portable]
// 1) 默认走国内镜像源下载 electron / electron-builder 构建工具，规避 GitHub 网络不稳。
// 2) 必须在 `node --use-system-ca` 下运行：本机装有本地根证书(HTTPS 中间代理)，
//    让 electron-builder 信任系统根证书，否则下载会报 "unable to verify the first certificate"。
// 3) 打包目标与包配置统一读 package.json 的 build 字段；--portable 时改打单文件便携版。
'use strict'
const { build } = require('electron-builder')

process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
  'https://npmmirror.com/mirrors/electron-builder-binaries/'
process.env.ELECTRON_MIRROR =
  process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'

const portable = process.argv.includes('--portable')
const options = portable
  ? { config: { win: { target: [{ target: 'portable', arch: ['x64'] }] } } }
  : {}

build(options)
  .then(() => {
    console.log('打包完成。')
    process.exit(0)
  })
  .catch((err) => {
    console.error('打包失败：', err)
    process.exit(1)
  })