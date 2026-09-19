import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitApplyOptions, GitConfigEntry, GitProxyScope, GitStatus } from '../shared/types'

const execFileAsync = promisify(execFile)

// 本工具管理的 git 配置键
const PROXY_KEYS: Record<GitProxyScope, string[]> = {
  global: ['http.proxy', 'https.proxy'],
  github: ['http.https://github.com/.proxy']
}
const REWRITE_KEY = 'url.https://github.com/.insteadOf'
const REWRITE_VALUE = 'git://github.com/'

async function runGit(args: string[]): Promise<{ out: string; code: number }> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    })
    return { out: stdout.trim(), code: 0 }
  } catch (err) {
    const code = (err as { code?: string | number })?.code
    // git 未安装时 code=EACCES/ENOENT，配置未设时(通过 --get)退出码 1
    if (typeof code === 'number') return { out: '', code }
    return { out: '', code: -1 }
  }
}

export async function getGitStatus(): Promise<GitStatus> {
  const probe = await runGit(['--version'])
  if (!probe.out) return { installed: false, entries: [] }
  const version = probe.out.replace(/^git version\s*/, '')

  const trackedKeys = [
    ...PROXY_KEYS.global,
    ...PROXY_KEYS.github,
    REWRITE_KEY
  ]
  const entries: GitConfigEntry[] = []
  for (const key of trackedKeys) {
    const r = await runGit(['config', '--global', '--get', key])
    if (r.code === 0) entries.push({ key, value: r.out })
  }
  return { installed: true, version, entries }
}

function cleanProxyValue(host: string, port: number): string {
  const h = host.trim()
  // 用户可能已输入 http:// 前缀，直接使用；否则补全
  return /^https?:\/\//.test(h) ? `${h}:${port}` : `http://${h}:${port}`
}

export async function applyGitProxy(options: GitApplyOptions): Promise<{ applied: string[] }> {
  const host = (options.host || '').trim()
  const port = Number(options.port)
  if (!host || !port || port <= 0 || port > 65535) {
    throw new Error('代理地址或端口无效')
  }
  const applied: string[] = []
  const proxyUrl = cleanProxyValue(host, port)

  for (const key of PROXY_KEYS[options.scope]) {
    const r = await runGit(['config', '--global', key, proxyUrl])
    if (r.code === 0) applied.push(key)
    else throw new Error(`写入 git 配置失败：${key}`)
  }

  if (options.rewriteGit) {
    const r = await runGit(['config', '--global', REWRITE_KEY, REWRITE_VALUE])
    if (r.code === 0) applied.push(REWRITE_KEY)
  }
  return { applied }
}

export async function clearGitProxy(scope: GitProxyScope): Promise<{ cleared: string[] }> {
  const cleared: string[] = []
  const keys = [
    ...PROXY_KEYS[scope],
    ...(scope === 'github' ? [REWRITE_KEY] : [])
  ]
  for (const key of keys) {
    const r = await runGit(['config', '--global', '--unset-all', key])
    if (r.code === 0) cleared.push(key)
  }
  return { cleared }
}

export async function clearAllGitProxy(): Promise<{ cleared: string[] }> {
  const cleared: string[] = []
  const keys = [...PROXY_KEYS.global, ...PROXY_KEYS.github, REWRITE_KEY]
  for (const key of keys) {
    const r = await runGit(['config', '--global', '--unset-all', key])
    if (r.code === 0) cleared.push(key)
  }
  return { cleared }
}