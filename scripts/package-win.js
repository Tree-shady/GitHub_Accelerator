// Windows 打包 + 代码签名包装脚本
// 用法：node --use-system-ca scripts/package-win.js [--portable]
//
// 环境变量：
//   CSC_LINK           代码签名证书 .pfx 的绝对路径（也可传 base64 编码的 pfx 内容）
//   CSC_KEY_PASSWORD   证书私钥密码（无密码可省略）
//   SIGN_TIMESTAMP_URL 可选，时间戳服务器，默认 DigiCert
//   不设 CSC_LINK 时=当前未签名模式，脚本行为与之前一致。
//
// 顺序（保证产物全签名）：
//  1) 若提供了证书，先对 build/elevate-copy.exe 签名（打包前签，安装后解出的即签名副本）；
//  2) 调用 electron-builder 打包——它会用证书自动签名主程序 / 卸载器 / 安装包；
//  3) 打包完成后对 release 下所有 exe 逐一签名校验。
'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')
const { build } = require('electron-builder')

process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
  'https://npmmirror.com/mirrors/electron-builder-binaries/'
process.env.ELECTRON_MIRROR =
  process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'

const RELEASE_DIR = path.join(__dirname, '..', 'release')
const HELPER = path.join(__dirname, '..', 'build', 'elevate-copy.exe')
const TIMESTAMP_URL =
  process.env.SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com'

// ---------- 证书与 signtool 定位 ----------

function findSigntool() {
  // 1) 显式指定的路径
  if (process.env.SIGTOOL && fs.existsSync(process.env.SIGTOOL)) return process.env.SIGTOOL
  // 2) electron-builder 缓存里的 winCodeSign 附带 signtool
  const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache')
  const stack = [cacheDir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name.toLowerCase() === 'signtool.exe') return p
    }
  }
  // 3) Windows SDK 默认安装路径
  const kits = path.join(process.env.ProgramFilesx86 || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
  if (fs.existsSync(kits)) {
    for (const ver of fs.readdirSync(kits).sort().reverse()) {
      const p = path.join(kits, ver, 'x64', 'signtool.exe')
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

const PROJECT_ROOT = path.join(__dirname, '..')
const CERT_DIR = path.join(PROJECT_ROOT, 'cert')
const CERT_ENV = path.join(CERT_DIR, 'env')

// 未显式指定证书时，自动探测 cert/*.pfx（该目录已被 .gitignore 忽略）
function defaultPfx() {
  if (!fs.existsSync(CERT_DIR)) return null
  const found = fs
    .readdirSync(CERT_DIR)
    .find((n) => n.toLowerCase().endsWith('.pfx'))
  return found ? path.join(CERT_DIR, found) : null
}

// 从 cert/env 读取私钥密码（避免把密码写进脚本/命令行/历史记录）
function passwordFromCertEnv() {
  if (!fs.existsSync(CERT_ENV)) return ''
  const m = fs
    .readFileSync(CERT_ENV, 'utf8')
    .match(/^\s*CSC_KEY_PASSWORD\s*=\s*(.*?)\s*$/m)
  return m ? (m[1] || '').trim() : ''
}

function resolveCert() {
  const envLink = process.env.CSC_LINK
  const link = envLink || defaultPfx()
  if (!link) return null
  const password = process.env.CSC_KEY_PASSWORD || passwordFromCertEnv()
  if (fs.existsSync(link)) return { pfx: link, password, temp: false }
  if (!envLink) return null
  try {
    const tmp = path.join(os.tmpdir(), `csc-${Date.now()}.pfx`)
    fs.writeFileSync(tmp, Buffer.from(envLink, 'base64'))
    return { pfx: tmp, password, temp: true }
  } catch {
    return null
  }
}

// ---------- 签名与校验 ----------

function signFile(signtool, cert, file) {
  const args = [
    'sign',
    '/fd', 'SHA256',
    '/tr', TIMESTAMP_URL,
    '/td', 'SHA256',
    '/f', cert.pfx
  ]
  if (cert.password) args.push('/p', cert.password)
  args.push('/a', file)
  execFileSync(signtool, args, { stdio: 'inherit' })
}

function collectExeFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectExeFiles(p, out)
    else if (p.toLowerCase().endsWith('.exe')) out.push(p)
  }
  return out
}

function signAll(signtool, cert) {
  console.log('\n[签名] 使用证书: ' + cert.pfx)
  // 1) 先签打包源件的 elevate-copy.exe，使安装包内即为签名副本
  if (fs.existsSync(HELPER)) {
    console.log('[签名] elevate-copy.exe')
    signFile(signtool, cert, HELPER)
  }
  // 2) 打包完成后签名产物里仍未签名/被覆盖的 exe（幂等，重复签不影响）
  for (const f of collectExeFiles(RELEASE_DIR)) {
    console.log('[签名] ' + path.relative(RELEASE_DIR, f))
    try {
      execFileSync(signtool, ['verify', '/pa', f], { stdio: 'ignore' })
      console.log('       · 已签名，跳过')
    } catch {
      signFile(signtool, cert, f)
    }
  }
}

function verifyAll(signtool) {
  console.log('\n[校验] 产物签名：')
  const exes = collectExeFiles(RELEASE_DIR)
  if (fs.existsSync(HELPER)) exes.unshift(HELPER)
  let ok = true
  for (const f of exes) {
    try {
      execFileSync(signtool, ['verify', '/pa', '/q', f], { stdio: 'ignore' })
      console.log('  OK   ' + path.relative(RELEASE_DIR, f))
    } catch (e) {
      ok = false
      console.log('  FAIL ' + path.relative(RELEASE_DIR, f) + '  (' + (e.message || '').split('\n')[0] + ')')
    }
  }
  if (!ok) {
    console.error('\n存在未签名/签名校验失败的 exe，请检查。')
    process.exitCode = 1
  }
}

// ---------- 主流程 ----------

async function main() {
  const cert = resolveCert()
  const signtool = findSigntool()

  if (cert) {
    if (!signtool) {
      console.error('[签名] 检测到 CSC_LINK，但未找到 signtool.exe。')
      console.error('[签名] 请用环境变量 SIGTOOL 指定 signtool 路径，或先跑一次打包下载 winCodeSign，或用文件资源管理器装 Windows SDK。')
    } else {
      // 打包前先签源件
      if (fs.existsSync(HELPER)) {
        console.log('[签名] 打包前签名 elevate-copy.exe …')
        signFile(signtool, cert, HELPER)
      }
      // 交给 electron-builder：它用这两个环境变量自动签主程序/卸载器/安装包
      process.env.CSC_LINK = cert.pfx
      process.env.CSC_KEY_PASSWORD = cert.password
    }
  } else {
    console.log('[签名] 未配置 CSC_LINK，以「未签名」模式打包（杀软可能仍会误报）。')
  }

  const portable = process.argv.includes('--portable')
  const options = portable
    ? { config: { win: { target: [{ target: 'portable', arch: ['x64'] }] } } }
    : {}

  await build(options)

  if (cert && signtool) {
    signAll(signtool, cert)
    verifyAll(signtool)
  }
  console.log('打包完成。')
}

main()
  .catch((err) => {
    console.error('打包失败：', err)
    process.exit(1)
  })