import { app } from 'electron'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HostEntry, HostsStatus } from '../shared/types'

const execFileAsync = promisify(execFile)

const BEGIN_MARKER = '# >>> github-accelerator begin <<<'
const END_MARKER = '# >>> github-accelerator end <<<'

const WS_RE = /[\s\t]+/

export function getHostsPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  }
  return '/etc/hosts'
}

function getBackupPath(): string {
  return path.join(app.getPath('userData'), 'hosts-backup', 'hosts.backup')
}

async function readHosts(): Promise<string> {
  return await fs.readFile(getHostsPath(), 'utf8')
}

async function writeHostsLiteral(content: string): Promise<void> {
  // 统一换行为目标文件的自然换行，避免 Windows/Linux 差异
  await fs.writeFile(getHostsPath(), content, 'utf8')
}

function buildBlock(entries: HostEntry[]): string {
  const lines = [
    BEGIN_MARKER,
    '# 由 GitHub 加速工具管理，可一键还原，请勿手动编辑此区间',
    ...entries.map((e) => `${e.ip} ${e.host}`),
    END_MARKER
  ]
  return lines.join('\n')
}

interface SplitResult {
  before: string[]
  after: string[]
  block: string[] | null
}

function locateManagedBlock(content: string): SplitResult {
  const lines = content.split(/\r?\n/)
  const beginIdx = lines.findIndex((l) => l.trim() === BEGIN_MARKER)
  if (beginIdx === -1) {
    return { before: lines, after: [], block: null }
  }
  const endIdx = lines.findIndex((l, i) => i > beginIdx && l.trim() === END_MARKER)
  const realEnd = endIdx === -1 ? lines.length - 1 : endIdx
  return {
    before: lines.slice(0, beginIdx),
    after: lines.slice(realEnd + 1),
    block: lines.slice(beginIdx, realEnd + 1)
  }
}

function hasManagedBlock(content: string): boolean {
  return content.split(/\r?\n/).some((l) => l.trim() === BEGIN_MARKER)
}

function validateEntries(entries: HostEntry[]): HostEntry[] {
  const seen = new Set<string>()
  const valid: HostEntry[] = []
  for (const e of entries) {
    const ip = (e.ip || '').trim()
    const host = (e.host || '').trim().split(WS_RE)[0]
    if (!ip || !host || seen.has(host)) continue
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue
    seen.add(host)
    valid.push({ ip, host })
  }
  return valid
}

async function checkAdmin(): Promise<boolean> {
  const hostsPath = getHostsPath()
  if (!existsSync(hostsPath)) return true
  // 用"追加模式打开但不写入"探测真实写权限：无权限时会抛 EPERM，不会改动文件内容
  try {
    const fh = await fs.open(hostsPath, 'a')
    await fh.close()
    return true
  } catch {
    return false
  }
}

// 枚举可能的 powershell 绝对路径候选，避免依赖 PATH 导致 spawn 失败
function powershellCandidates(): string[] {
  const windir = process.env.WINDIR || 'C:\\Windows'
  const base = [
    path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    // 32 位进程可用 sysnative 访问真实 System32 的 64 位 PowerShell
    path.join(windir, 'sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(windir, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ]
  return [...new Set(base)].filter((p) => existsSync(p))
}

// 逐候选执行 powershell，全部返回规范错误；spawn 阶段即失败的场景（如受限沙箱）会在此暴露明确原因
async function runPowershell(args: string[]): Promise<void> {
  const candidates = powershellCandidates()
  if (candidates.length === 0) candidates.push('powershell.exe')
  let lastErr: unknown = null
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, args, { windowsHide: true })
      return
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      lastErr = err
      // spawn 阶段被系统拒绝（EPERM/受限令牌）时，改用下一个候选没有意义，直接抛出说明
      if (e && e.code === 'EPERM') break
    }
  }
  throw new Error(
    '无法启动 PowerShell 提权进程（' +
      (lastErr ? (lastErr as Error).message : '未知错误') +
      '）。若在沙箱/受限环境运行，请以管理员权限直接运行本应用后重试。'
  )
}

// 定位提权辅助程序：优先打包随附的 resources/elevate-copy.exe，其次开发目录 build/
function elevateCopyPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'elevate-copy.exe'),
    path.join(app.getAppPath(), 'build', 'elevate-copy.exe')
  ]
  return candidates.find((p) => existsSync(p)) || null
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// 无写权限时，通过带 requireAdministrator 清单的辅助进程覆盖 hosts（会触发 UAC 提示）。
// 优先走编译好的 elevate-copy.exe；仅在开发环境无辅助程序时兜底用 PowerShell 脚本复制。
async function writeViaElevation(content: string): Promise<void> {
  const hostsPath = getHostsPath()
  const staging = path.join(app.getPath('userData'), 'hosts-staging')
  await fs.writeFile(staging, content, 'utf8')

  const helper = elevateCopyPath()
  if (helper) {
    try {
      await elevateViaStartProcess(helper, staging, hostsPath)
      return
    } catch (err) {
      // 辅助程序失败：可能是旧/损坏的 helper（不写结果、无法提权），也可能是系统拦截。
      // 若并非用户取消 UAC，则用 PowerShell -Verb RunAs 兜底再执行一次真正的提权复制。
      if (errText(err).includes('提权被取消')) throw err
      await writeViaElevationViaPowershell(staging, hostsPath)
      return
    }
  }

  await writeViaElevationViaPowershell(staging, hostsPath)
}

// 通过 ShellExecute(start-process) 拉起带 requireAdministrator 清单的辅助进程以触发 UAC。
// 注意：execFile/spawn 走 CreateProcess，无法请求提升（会报 EACCES/740），
// 因此必须用 Start-Process(内部走 ShellExecute) 由清单触发 UAC 弹窗。
// 路径经环境变量传入，命令简单可读，不再使用编码脚本，兼顾低误报。
async function elevateViaStartProcess(helper: string, staging: string, hostsPath: string): Promise<void> {
  // 结果文件：辅助程序/外层 PS 把真实失败原因和退出码写回，便于区分"取消 UAC"与"复制失败"
  const resultPath = staging + '.result'

  // hosts 常被 DNS/杀软瞬时占用，重试若干次以越过瞬时锁文件
  const MAX_ATTEMPTS = 3
  let last: { code: number; detail: string } | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await fs.rm(resultPath, { force: true })
    } catch {
      /* 清理失败可忽略 */
    }

    // 101 = Start-Process 本身抛错（多为取消 UAC/被拒），出错信息写入 resultPath 后由 Node 取回
    const cmd = [
      "$ErrorActionPreference='Stop'",
      'if (-not $env:GA_HELPER) { exit 2 }',
      'try { $p = Start-Process -FilePath $env:GA_HELPER -ArgumentList $env:GA_STAGING,$env:GA_HOSTS,$env:GA_RESULT -Wait -PassThru; exit $p.ExitCode }',
      'catch { try { Set-Content -LiteralPath $env:GA_RESULT -Value $_.Exception.Message } catch {}; exit 101 }'
    ].join('; ')
    const bin = powershellCandidates()[0] || 'powershell.exe'

    let code: number
    try {
      await execFileAsync(
        bin,
        ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd],
        {
          windowsHide: true,
          env: {
            ...process.env,
            GA_HELPER: helper,
            GA_STAGING: staging,
            GA_HOSTS: hostsPath,
            GA_RESULT: resultPath
          }
        }
      )
      code = 0
    } catch (err) {
      code = (err as { code?: number }).code ?? 1
    }

    let detail = ''
    try {
      detail = (await fs.readFile(resultPath, 'utf8')).trim()
    } catch {
      /* 无结果文件则保留空 */
    }

    if (code === 0) {
      // 成功；剩余交由 commit() 的 round-trip 校验确认
      return
    }
    if (code !== 101 && code !== 2 && attempt < MAX_ATTEMPTS) {
      // 复制失败多为瞬时锁文件，重试
      last = { code, detail }
      await new Promise((r) => setTimeout(r, 300 * attempt))
      continue
    }
    last = { code, detail }
    break
  }

  const { code, detail } = last ?? { code: -1, detail: '' }
  const reason = detail ? `（${detail}）` : ''
  if (code === 101) {
    throw new Error(
      '提权被取消或受限：未获得管理员授权。' + reason + '请重新点击并允许 UAC 提权。'
    )
  }
  if (code === 2) {
    throw new Error('未找到提权辅助程序（elevate-copy.exe），请重新安装或补充该文件。')
  }
  if (code === 3) {
    throw new Error('辅助程序报告：目标文件写入后不存在（' + (detail || '未知') + '）。')
  }
  throw new Error(
    `提权后复制 hosts 失败（辅助程序退出码 ${code}${reason}）。` +
      (detail ? ' 请按提示处理；' : ' 未获取到具体原因，请确认以管理员权限运行本应用后重试。') +
      ' 若目标被程序占用，请关闭占用程序后重试。'
  )
}

// 兜底实现：用 -EncodedCommand 传 Base64(UTF-16LE) 子命令，规避多层嵌套引号的解析问题
async function writeViaElevationViaPowershell(staging: string, hostsPath: string): Promise<void> {
  const inner = [
    "$ErrorActionPreference='Stop'",
    `Copy-Item -Force -LiteralPath ${quotePs(staging)} -Destination ${quotePs(hostsPath)}`,
    `if (-not (Test-Path -LiteralPath ${quotePs(hostsPath)})) { exit 1 }`
  ].join('; ')
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')
  const outer = [
    "$ErrorActionPreference='Stop'",
    'Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden',
    `-ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`
  ].join('; ')

  await runPowershell(['-ExecutionPolicy', 'Bypass', '-Command', outer])
}

function quotePs(v: string): string {
  // PowerShell 单引号字符串内转义单引号
  return "'" + v.replace(/'/g, "''") + "'"
}

async function commit(content: string): Promise<{ wrote: boolean; elevated: boolean }> {
  // 先尝试直接写入（已提权/本就可写时无需弹 UAC）
  try {
    await writeHostsLiteral(content)
    return { wrote: true, elevated: false }
  } catch (err) {
    // Windows 下无写权限时回退到提权写入（触发 UAC），写入前 open 即失败，目标文件未被动过
    if (process.platform !== 'win32') throw err
  }
  await writeViaElevation(content)
  const roundTrip = await readHosts()
  if (roundTrip.trim() !== content.trim()) {
    throw new Error('提权写入后校验失败，请检查 hosts 文件')
  }
  return { wrote: true, elevated: true }
}

export async function getHostsStatus(): Promise<HostsStatus> {
  const hostsPath = getHostsPath()
  const backupPath = getBackupPath()
  const exists = existsSync(hostsPath)
  let hasManaged = false
  if (exists) {
    try {
      hasManaged = hasManagedBlock(await readHosts())
    } catch {
      /* 读取失败则忽略 */
    }
  }
  return {
    path: hostsPath,
    exists,
    admin: await checkAdmin(),
    hasManagedBlock: hasManaged,
    backupPath,
    backupExists: existsSync(backupPath)
  }
}

function ensureBackupDir(dir: string): Promise<void> {
  return fs.mkdir(dir, { recursive: true }).then(() => undefined)
}

async function createBackupOnce(): Promise<string> {
  const backupPath = getBackupPath()
  if (!existsSync(backupPath) && existsSync(getHostsPath())) {
    await ensureBackupDir(path.dirname(backupPath))
    await fs.copyFile(getHostsPath(), backupPath)
  }
  return backupPath
}

export async function applyHosts(input: HostEntry[]): Promise<{
  entries: HostEntry[]
  wrote: boolean
  elevated: boolean
  backupPath: string
}> {
  const entries = validateEntries(input)
  if (!entries.length) {
    throw new Error('没有可用的有效条目（需要可达的 IPv4 地址）')
  }
  await createBackupOnce()
  const original = await readHosts().catch(() => '')
  const split = locateManagedBlock(original)
  const replacement = buildBlock(entries)
  const content =
    stripTrailingBlank([...split.before, replacement, ...split.after].join('\n')) + '\n'

  const { elevated } = await commit(content)
  return { entries, wrote: true, elevated, backupPath: getBackupPath() }
}

function stripTrailingBlank(s: string): string {
  return s.replace(/\n+$/, '')
}

export async function revertHosts(): Promise<{ removed: boolean; elevated: boolean }> {
  if (!existsSync(getHostsPath())) {
    return { removed: false, elevated: false }
  }
  const original = await readHosts()
  const split = locateManagedBlock(original)
  if (split.block === null) {
    return { removed: false, elevated: false }
  }
  const content =
    stripTrailingBlank([...split.before, ...split.after].join('\n')) + '\n'
  const { elevated } = await commit(content)
  return { removed: true, elevated }
}