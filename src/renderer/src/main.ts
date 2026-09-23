import './style.css'
import { containsGitHubUrl, rewriteGitHubUrls } from './rewrite'
import type {
  GitConfigEntry,
  GitProxyScope,
  GitStatus,
  HostEntry,
  HostsStatus,
  ProxyConfig,
  Target,
  TargetReport
} from '../../shared/types'

interface TargetState {
  raw: Target
  status: 'idle' | 'pending' | 'reachable' | 'unreachable'
  report?: TargetReport
}

const runBtn = document.getElementById('runBtn') as HTMLButtonElement
const proxyToggle = document.getElementById('proxyToggle') as HTMLInputElement
const proxyPanel = document.getElementById('proxyPanel') as HTMLElement
const proxyHost = document.getElementById('proxyHost') as HTMLInputElement
const proxyPort = document.getElementById('proxyPort') as HTMLInputElement
const targetList = document.getElementById('targetList') as HTMLElement
const statTotal = document.getElementById('statTotal') as HTMLElement
const statOk = document.getElementById('statOk') as HTMLElement
const statBad = document.getElementById('statBad') as HTMLElement
const statAvg = document.getElementById('statAvg') as HTMLElement
const statGrade = document.getElementById('statGrade') as HTMLElement

const hostsDot = document.getElementById('hostsDot') as HTMLElement
const hostsApplyBtn = document.getElementById('hostsApplyBtn') as HTMLButtonElement
const hostsRevertBtn = document.getElementById('hostsRevertBtn') as HTMLButtonElement
const hostsRefreshBtn = document.getElementById('hostsRefreshBtn') as HTMLButtonElement
const hostsMeta = document.getElementById('hostsMeta') as HTMLElement
const hostsPreview = document.getElementById('hostsPreview') as HTMLElement
const hostsMsg = document.getElementById('hostsMsg') as HTMLElement

const gitDot = document.getElementById('gitDot') as HTMLElement
const gitApplyBtn = document.getElementById('gitApplyBtn') as HTMLButtonElement
const gitClearBtn = document.getElementById('gitClearBtn') as HTMLButtonElement
const gitRefreshBtn = document.getElementById('gitRefreshBtn') as HTMLButtonElement
const gitProxyHost = document.getElementById('gitProxyHost') as HTMLInputElement
const gitProxyPort = document.getElementById('gitProxyPort') as HTMLInputElement
const gitRewrite = document.getElementById('gitRewrite') as HTMLInputElement
const gitMeta = document.getElementById('gitMeta') as HTMLElement
const gitPreview = document.getElementById('gitPreview') as HTMLElement
const gitMsg = document.getElementById('gitMsg') as HTMLElement

const urlDot = document.getElementById('urlDot') as HTMLElement
const urlReadBtn = document.getElementById('urlReadBtn') as HTMLButtonElement
const urlRewriteBtn = document.getElementById('urlRewriteBtn') as HTMLButtonElement
const urlInput = document.getElementById('urlInput') as HTMLTextAreaElement
const mirrorInput = document.getElementById('mirrorInput') as HTMLInputElement
const urlResult = document.getElementById('urlResult') as HTMLElement
const urlMsg = document.getElementById('urlMsg') as HTMLElement

let states: TargetState[] = []
let lastReports: TargetReport[] | null = null

const bannerMsg = document.getElementById('bannerMsg') as HTMLElement

// 顶部的全局提示条，用于展示检测级错误等与具体卡片无关的信息
function setBanner(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  bannerMsg.textContent = text
  bannerMsg.className = 'banner' + (kind ? ` ${kind}` : '') + (text ? '' : ' hidden')
}

function init(): void {
  if (window.api) {
    window.api.getTargets().then((list) => {
      states = list.map((raw) => ({ raw, status: 'idle' }))
      render()
    })
    void refreshHostsStatus()
    void refreshGitStatus()
    void refreshIppool()
    void refreshLog()
  } else {
    // 无 preload 时用默认目标（例如在纯浏览器调试场景）
    const defaults: Target[] = [
      { name: 'github.com', host: 'github.com', ports: [443, 22] },
      { name: 'api.github.com', host: 'api.github.com', ports: [443] },
      { name: 'raw.githubusercontent.com', host: 'raw.githubusercontent.com', ports: [443] }
    ]
    states = defaults.map((raw) => ({ raw, status: 'idle' }))
    render()
  }
}

proxyToggle.addEventListener('change', () => {
  proxyPanel.classList.toggle('hidden', !proxyToggle.checked)
})

runBtn.addEventListener('click', run)

async function run(): Promise<void> {
  if (!states.length) return
  runBtn.disabled = true
  runBtn.textContent = '检测中…'

  const proxy: ProxyConfig | undefined = proxyToggle.checked
    ? { host: proxyHost.value.trim() || '127.0.0.1', port: Number(proxyPort.value) || 7890 }
    : undefined

  setAll('pending')
  setBanner('', '')
  try {
    const reports = await window.api.testConnectivity({
      targets: states.map((s) => s.raw),
      proxy
    })
    applyReports(reports)
  } catch (err) {
    setAll('unreachable')
    setBanner(`检测失败：${errMessage(err)}`, 'err')
    console.error(err)
  } finally {
    runBtn.disabled = false
    runBtn.textContent = '重新检测'
  }
}

function setAll(status: TargetState['status']): void {
  states = states.map((s) => ({ ...s, status: status === 'pending' ? 'pending' : 'unreachable', report: status === 'pending' ? undefined : s.report }))
  render()
}

function applyReports(reports: TargetReport[]): void {
  lastReports = reports
  states = states.map((s) => {
    const report = reports.find((r) => r.name === s.raw.name)
    if (!report) return s
    const reachable = !!report.best
    return {
      ...s,
      status: reachable ? 'reachable' : 'unreachable',
      report
    }
  })
  render()
  updateSummary()
}

function updateSummary(): void {
  const total = states.length
  const ok = states.filter((s) => s.status === 'reachable').length
  const bad = states.filter((s) => s.status === 'unreachable').length
  const latencies = states
    .flatMap((s) => (s.report?.best ? [s.report.best.latencyMs] : []))
    .filter((v) => v >= 0)
  const avg =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null

  statTotal.textContent = String(total)
  statOk.textContent = String(ok)
  statBad.textContent = String(bad)
  statAvg.textContent = avg !== null ? `${avg} ms` : '–'

  const ratio = total > 0 ? ok / total : 0
  let grade = '–'
  let gradeClass = ''
  if (avg !== null && ratio > 0) {
    if (ratio === 1 && avg < 300) {
      grade = '极佳'
      gradeClass = 'ok'
    } else if (ratio >= 0.8) {
      grade = avg < 600 ? '良好' : '可用'
      gradeClass = avg < 600 ? 'ok' : 'warn'
    } else {
      grade = '较差'
      gradeClass = 'bad'
    }
  } else if (ratio === 0) {
    grade = '不可达'
    gradeClass = 'bad'
  }
  statGrade.className = 'stat-value'
  if (gradeClass) statGrade.classList.add(gradeClass === 'warn' ? 'warn' : gradeClass)
  statGrade.textContent = grade
}

function portLabel(port: number, isProxy: boolean): string {
  return isProxy ? `${port}` : `:${port}`
}

function render(): void {
  targetList.innerHTML = ''
  for (const s of states) {
    targetList.appendChild(renderCard(s))
  }
}

function renderCard(s: TargetState): HTMLElement {
  const card = document.createElement('div')
  card.className = `target-card ${s.status}`
  card.dataset.name = s.raw.name

  const head = document.createElement('div')
  head.className = 'target-head'

  const name = document.createElement('div')
  name.className = 'target-name'
  const dot = document.createElement('span')
  dot.className = `status-dot ${s.status}`
  name.appendChild(dot)
  name.appendChild(document.createTextNode(s.raw.name))

  const host = document.createElement('span')
  host.style.cssText = 'color:var(--text-dim);font-size:12px;font-weight:400;'
  host.textContent = s.raw.host
  name.appendChild(host)

  head.appendChild(name)

  const badge = document.createElement('div')
  badge.className = 'target-badge'
  if (s.status === 'reachable' && s.report?.best) {
    badge.textContent = `可达 · ${s.report.best.latencyMs} ms`
  } else if (s.status === 'unreachable') {
    badge.textContent = '不可达'
  } else if (s.status === 'pending') {
    badge.textContent = '检测中…'
  } else {
    badge.textContent = '待检测'
  }
  head.appendChild(badge)

  card.appendChild(head)

  const ports = document.createElement('div')
  ports.className = 'ports'
  for (const port of s.raw.ports) {
    const chip = document.createElement('span')
    chip.className = 'port-chip'
    if (s.status === 'reachable' && s.report) {
      const portProbes = s.report.ports.filter((x) => x.port === port)
      // 同一端口可能有多个候选 IP 的探测结果，优先显示连通的，避免被首条失败结果误导
      const p = portProbes.find((x) => x.connected) || portProbes[0]
      if (p?.connected) {
        chip.classList.add('ok')
        chip.textContent = `${portLabel(port, false)} 连通 ${p.latencyMs}ms`
      } else {
        chip.classList.add('bad')
        chip.textContent = `${portLabel(port, false)} 失败`
      }
    } else if (s.status === 'unreachable') {
      chip.classList.add('bad')
      chip.textContent = `${portLabel(port, false)} 失败`
    } else {
      chip.classList.add('dim')
      chip.textContent = portLabel(port, false)
    }
    ports.appendChild(chip)
  }
  card.appendChild(ports)

  return card
}

function buildHostEntries(): HostEntry[] {
  if (!lastReports) return []
  const entries: HostEntry[] = []
  for (const r of lastReports) {
    if (!r.best || !r.best.connected) continue
    // 直连模式下 remoteIp 即实际建连 IP；否则退回 DNS 解析 IP
    const ip = r.best.remoteIp || r.best.ip
    if (ip) entries.push({ ip, host: r.host })
  }
  return entries
}

function setHostsMsg(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  hostsMsg.textContent = text
  hostsMsg.className = 'hosts-msg' + (kind ? ` ${kind}` : '')
}

function renderHostsPreview(entries: HostEntry[]): void {
  hostsPreview.innerHTML = ''
  if (!entries.length) return
  const title = document.createElement('div')
  title.className = 'preview-title'
  title.textContent = '将写入的条目（基于最近一次直连检测结果）：'
  const pre = document.createElement('pre')
  pre.textContent = entries.map((e) => `${e.ip}    ${e.host}`).join('\n')
  hostsPreview.appendChild(title)
  hostsPreview.appendChild(pre)
}

async function refreshHostsStatus(): Promise<void> {
  if (!window.api) return
  try {
    const st: HostsStatus = await window.api.hosts.status()
    hostsDot.className = `status-dot ${st.hasManagedBlock ? 'reachable' : 'idle'}`
    hostsMeta.innerHTML = [
      `Hosts 路径：<code>${st.path}</code>`,
      `当前管理段：${st.hasManagedBlock ? '已启用' : '未启用'}`,
      `写入权限：${st.admin ? '管理员' : '受限（应用时会请求提权）'}`,
      `备份：${st.backupExists ? '已创建' : '未创建'}`
    ]
      .map((s) => `<span>${s}</span>`)
      .join('')
  } catch (err) {
    console.error(err)
  }
}

hostsApplyBtn.addEventListener('click', async () => {
  const entries = buildHostEntries()
  if (!entries.length) {
    setHostsMsg('暂无可用条目：请先执行一次「直连」检测且保证有可达域名。', 'warn')
    return
  }
  if (proxyToggle.checked) {
    setHostsMsg('提示：代理模式下检测到的 IP 是代理服务器地址，写入 hosts 无效，请关闭代理后检测。', 'warn')
    return
  }
  hostsApplyBtn.disabled = true
  setHostsMsg('正在写入 hosts…', '')
  try {
    const res = await window.api.hosts.apply(entries)
    renderHostsPreview(res.entries)
    setHostsMsg(
      `已应用 ${res.entries.length} 条条目。${res.elevated ? '（通过提权进程写入）' : ''} 备份位于：${res.backupPath}`,
      'ok'
    )
    await refreshHostsStatus()
  } catch (err) {
    setHostsMsg(`应用失败：${errMessage(err)}`, 'err')
  } finally {
    hostsApplyBtn.disabled = false
  }
})

hostsRevertBtn.addEventListener('click', async () => {
  hostsRevertBtn.disabled = true
  setHostsMsg('正在还原…', '')
  try {
    const res = await window.api.hosts.revert()
    setHostsMsg(
      res.removed
        ? `已移除管理段。${res.elevated ? '（通过提权进程写入）' : ''}`
        : '未发现由本工具添加的管理段，无需还原。',
      res.removed ? 'ok' : 'warn'
    )
    hostsPreview.innerHTML = ''
    await refreshHostsStatus()
  } catch (err) {
    setHostsMsg(`还原失败：${errMessage(err)}`, 'err')
  } finally {
    hostsRevertBtn.disabled = false
  }
})

hostsRefreshBtn.addEventListener('click', () => void refreshHostsStatus())

function setGitMsg(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  gitMsg.textContent = text
  gitMsg.className = 'hosts-msg' + (kind ? ` ${kind}` : '')
}

const GIT_KEY_LABELS: Record<string, string> = {
  'http.proxy': '全局 http.proxy',
  'https.proxy': '全局 https.proxy',
  'http.https://github.com/.proxy': 'GitHub 专用代理',
  'url.https://github.com/.insteadOf': 'git:// → https:// 改写'
}

function renderGitPreview(entries: GitConfigEntry[]): void {
  gitPreview.innerHTML = ''
  if (!entries.length) return
  const title = document.createElement('div')
  title.className = 'preview-title'
  title.textContent = '当前 ~/.gitconfig 中的相关配置：'
  const pre = document.createElement('pre')
  pre.textContent = entries
    .map((e) => `${GIT_KEY_LABELS[e.key] || e.key}: ${e.value}`)
    .join('\n')
  gitPreview.appendChild(title)
  gitPreview.appendChild(pre)
}

async function refreshGitStatus(): Promise<void> {
  if (!window.api) return
  try {
    const st: GitStatus = await window.api.git.status()
    if (!st.installed) {
      gitDot.className = 'status-dot unreachable'
      gitMeta.textContent = '未检测到 git，请先安装 Git 并确保在 PATH 中。'
      gitApplyBtn.disabled = true
      gitClearBtn.disabled = true
      renderGitPreview([])
      return
    }
    const hasProxy = st.entries.some((e) => e.key !== 'url.https://github.com/.insteadOf')
    gitDot.className = `status-dot ${hasProxy ? 'reachable' : 'idle'}`
    gitMeta.innerHTML = `git 版本：<code>${st.version || '?'}</code>` +
      (hasProxy ? ' · 已配置代理' : ' · 未配置代理')
    gitApplyBtn.disabled = false
    gitClearBtn.disabled = false
    renderGitPreview(st.entries)
  } catch (err) {
    console.error(err)
  }
}

gitApplyBtn.addEventListener('click', async () => {
  const scope = (
    document.querySelector<HTMLInputElement>('input[name="gitScope"]:checked')?.value ?? 'global'
  ) as GitProxyScope
  gitApplyBtn.disabled = true
  setGitMsg('正在写入 git 配置…', '')
  try {
    const res = await window.api.git.apply({
      host: gitProxyHost.value.trim() || '127.0.0.1',
      port: Number(gitProxyPort.value) || 7890,
      scope,
      rewriteGit: gitRewrite.checked
    })
    setGitMsg(
      `已写入 ${res.applied.length} 项配置${scope === 'github' ? '（仅 GitHub）' : '（全局）'}。`,
      'ok'
    )
    await refreshGitStatus()
  } catch (err) {
    setGitMsg(`应用失败：${errMessage(err)}`, 'err')
  } finally {
    gitApplyBtn.disabled = false
  }
})

gitClearBtn.addEventListener('click', async () => {
  gitClearBtn.disabled = true
  setGitMsg('正在清除…', '')
  try {
    const res = await window.api.git.clearAll()
    setGitMsg(res.cleared.length ? `已清除 ${res.cleared.length} 项配置。` : '没有需清除的配置。', res.cleared.length ? 'ok' : 'warn')
    await refreshGitStatus()
  } catch (err) {
    setGitMsg(`清除失败：${errMessage(err)}`, 'err')
  } finally {
    gitClearBtn.disabled = false
  }
})

gitRefreshBtn.addEventListener('click', () => void refreshGitStatus())

function setUrlMsg(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  urlMsg.textContent = text
  urlMsg.className = 'hosts-msg' + (kind ? ` ${kind}` : '')
}

urlReadBtn.addEventListener('click', async () => {
  if (!window.api) return
  try {
    const text = await window.api.clipboard.read()
    if (!text.trim()) {
      setUrlMsg('剪贴板为空。', 'warn')
      return
    }
    urlInput.value = text
    urlDot.className = 'status-dot reachable'
    if (containsGitHubUrl(text)) {
      setUrlMsg('已读取剪贴板，检测到 GitHub 链接，可直接改写。', 'ok')
    } else {
      setUrlMsg('已读取剪贴板（未识别到 GitHub 链接，仍可据此手动编辑）。', 'warn')
    }
  } catch (err) {
    setUrlMsg(`读取剪贴板失败：${errMessage(err)}`, 'err')
  }
})

urlRewriteBtn.addEventListener('click', async () => {
  const input = urlInput.value
  if (!input.trim()) {
    setUrlMsg('请在输入框粘贴内容，或点「读取剪贴板」。', 'warn')
    return
  }
  if (!window.api) return
  const mirror = mirrorInput.value.trim()
  if (!mirror) {
    setUrlMsg('请填写镜像地址。', 'warn')
    return
  }
  const rewritten = rewriteGitHubUrls(input, mirror)
  urlResult.textContent = rewritten
  if (rewritten === input) {
    setUrlMsg('未在其中识别到可改写的 GitHub 链接。', 'warn')
    urlDot.className = 'status-dot idle'
    return
  }
  try {
    await window.api.clipboard.write(rewritten)
    urlDot.className = 'status-dot reachable'
    setUrlMsg('改写完成，已复制到剪贴板。', 'ok')
  } catch (err) {
    setUrlMsg(`改写完成，但复制剪贴板失败：${errMessage(err)}`, 'warn')
  }
})

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/* ===================== 一键诊断并加速 ===================== */
const oneClickBtn = document.getElementById('oneClickBtn') as HTMLButtonElement

oneClickBtn.addEventListener('click', async () => {
  if (!window.api) return
  if (proxyToggle.checked) {
    setHostsMsg('一键加速需直连探测，请先关闭「使用代理」再试。', 'warn')
    return
  }
  oneClickBtn.disabled = true
  oneClickBtn.textContent = '诊断并应用中…'
  try {
    setAll('pending')
    const reports = await window.api.testConnectivity({
      targets: states.map((s) => s.raw),
      proxy: undefined
    })
    applyReports(reports)
    const entries = buildHostEntries()
    if (!entries.length) {
      setHostsMsg('诊断无可达域名，无法生成 hosts 条目，请检查网络或本机 GitHub 出口。', 'err')
      return
    }
    const res = await window.api.hosts.apply(entries)
    renderHostsPreview(res.entries)
    setHostsMsg(
      `一键加速完成：已应用 ${res.entries.length} 条条目。${res.elevated ? '（通过提权进程写入）' : ''}`,
      'ok'
    )
    await refreshHostsStatus()
  } catch (err) {
    setHostsMsg(`一键加速失败：${errMessage(err)}`, 'err')
  } finally {
    oneClickBtn.disabled = false
    oneClickBtn.textContent = '⚡ 一键诊断并加速'
  }
})

/* ===================== GitHub IP 池 ===================== */
const ippoolDot = document.getElementById('ippoolDot') as HTMLElement
const ippoolReadBtn = document.getElementById('ippoolReadBtn') as HTMLButtonElement
const ippoolSaveBtn = document.getElementById('ippoolSaveBtn') as HTMLButtonElement
const ippoolInput = document.getElementById('ippoolInput') as HTMLTextAreaElement
const ippoolMsg = document.getElementById('ippoolMsg') as HTMLElement

function setIppoolMsg(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  ippoolMsg.textContent = text
  ippoolMsg.className = 'hosts-msg' + (kind ? ` ${kind}` : '')
}

async function refreshIppool(): Promise<void> {
  if (!window.api) return
  try {
    const ips = await window.api.ippool.get()
    ippoolInput.value = ips.join('\n')
    ippoolDot.className = `status-dot ${ips.length ? 'reachable' : 'idle'}`
  } catch (err) {
    console.error(err)
  }
}

ippoolReadBtn.addEventListener('click', () => void refreshIppool())
ippoolSaveBtn.addEventListener('click', async () => {
  if (!window.api) return
  const ips = ippoolInput.value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    const saved = await window.api.ippool.set(ips)
    setIppoolMsg(`已保存 ${saved.length} 个自定义 IP，检测时并入兜底池。`, 'ok')
    ippoolDot.className = `status-dot ${saved.length ? 'reachable' : 'idle'}`
  } catch (err) {
    setIppoolMsg(`保存失败：${errMessage(err)}`, 'err')
  }
})

/* ===================== 操作日志 ===================== */
const logDot = document.getElementById('logDot') as HTMLElement
const logRefreshBtn = document.getElementById('logRefreshBtn') as HTMLButtonElement
const logExportBtn = document.getElementById('logExportBtn') as HTMLButtonElement
const logClearBtn = document.getElementById('logClearBtn') as HTMLButtonElement
const logView = document.getElementById('logView') as HTMLElement
const logMsg = document.getElementById('logMsg') as HTMLElement

function setLogMsg(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  logMsg.textContent = text
  logMsg.className = 'hosts-msg' + (kind ? ` ${kind}` : '')
}

async function refreshLog(): Promise<void> {
  if (!window.api) return
  const content = await window.api.log.get()
  logView.innerHTML = ''
  if (content.trim()) {
    for (const line of content.trim().split('\n')) {
      const div = document.createElement('div')
      div.textContent = line
      div.className = line.includes(' ERR ') ? 'err-line' : 'ok-line'
      logView.appendChild(div)
    }
  }
  logDot.className = `status-dot ${content.trim() ? 'reachable' : 'idle'}`
}

logRefreshBtn.addEventListener('click', () => void refreshLog())
logExportBtn.addEventListener('click', async () => {
  if (!window.api) return
  try {
    const res = await window.api.log.export('github-accelerator-operation.log')
    setLogMsg(res.canceled ? '已取消导出。' : `已导出到：${res.filePath}`, res.canceled ? '' : 'ok')
  } catch (err) {
    setLogMsg(`导出失败：${errMessage(err)}`, 'err')
  }
})
logClearBtn.addEventListener('click', async () => {
  if (!window.api) return
  try {
    await window.api.log.clear()
    await refreshLog()
    setLogMsg('已清空操作日志。', 'ok')
  } catch (err) {
    setLogMsg(`清空失败：${errMessage(err)}`, 'err')
  }
})

/* ===================== 加速测速（下载 / 上传 + 流量） ===================== */
const speedDot = document.getElementById('speedDot') as HTMLElement
const speedDownBtn = document.getElementById('speedDownBtn') as HTMLButtonElement
const speedUpBtn = document.getElementById('speedUpBtn') as HTMLButtonElement
const speedCancelBtn = document.getElementById('speedCancelBtn') as HTMLButtonElement
const speedUrl = document.getElementById('speedUrl') as HTMLInputElement
const speedNow = document.getElementById('speedNow') as HTMLElement
const speedAvg = document.getElementById('speedAvg') as HTMLElement
const speedTotal = document.getElementById('speedTotal') as HTMLElement
const speedTime = document.getElementById('speedTime') as HTMLElement
const speedCanvas = document.getElementById('speedCanvas') as HTMLCanvasElement
const speedMsg = document.getElementById('speedMsg') as HTMLElement

interface SpeedPoint {
  tSec: number
  bytes: number
}

let speedRunning = false
let speedMbps = false
const speedPoints: SpeedPoint[] = []

function setSpeedMsg(text: string, kind: '' | 'ok' | 'err' | 'warn'): void {
  speedMsg.textContent = text
  speedMsg.className = 'hosts-msg' + (kind ? ` ${kind}` : '')
}

function fmtRate(bps: number): string {
  return `${(bps / 1e6).toFixed(2)} MB/s`
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${n} B`
}

function drawSpeedCurve(points: SpeedPoint[], mbps: boolean): void {
  const ctx = speedCanvas.getContext('2d')
  if (!ctx) return
  const w = speedCanvas.width
  const h = speedCanvas.height
  ctx.clearRect(0, 0, w, h)

  const unit = mbps ? 1e6 : 1e3
  const peak = Math.max(1, ...points.map((p) => (p.bytes * 1000) / unit))

  // 网格
  ctx.strokeStyle = '#1e293b'
  ctx.fillStyle = '#8b97ad'
  ctx.font = '10px sans-serif'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = h - (h * i) / 4
    ctx.beginPath()
    ctx.moveTo(34, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    ctx.fillText(`${((peak * i) / 4).toFixed(1)}`, 4, y - 3)
  }

  // 柱状图（每秒一个柱）
  const bw = (w - 34) / Math.max(1, points.length)
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#3b82f6')
  grad.addColorStop(1, 'rgba(59,130,246,0.15)')
  ctx.fillStyle = grad
  for (let i = 0; i < points.length; i++) {
    const val = (points[i].bytes * 1000) / unit // 当前秒速率
    const bh = (h * val) / peak
    ctx.fillRect(34 + i * bw, h - bh, Math.max(1, bw - 1), bh)
  }
}

function updateSpeedStats(points: SpeedPoint[]): void {
  const last = points.length ? points[points.length - 1] : null
  const nowBps = last ? last.bytes * 1000 : 0
  speedNow.textContent = nowBps > 0 ? fmtRate(nowBps) : '–'
  const totalBytes = points.reduce((a, p) => a + p.bytes, 0)
  const avgBps = points.length ? totalBytes / Math.max(0.5, points.length) : 0
  speedAvg.textContent = avgBps > 0 ? `${(avgBps / 1e6).toFixed(2)} MB/s` : '–'
  speedTotal.textContent = fmtBytes(totalBytes * 1000)
  const t = points.length ? points[points.length - 1].tSec : 0
  speedTime.textContent = `${t.toFixed(1)} s`
}

async function runSpeed(kind: 'download' | 'upload'): Promise<void> {
  if (!window.api || speedRunning) return
  speedRunning = true
  speedMbps = true
  speedPoints.length = 0
  for (const b of [speedDownBtn, speedUpBtn, speedCancelBtn]) b.disabled = false
  speedDownBtn.disabled = true
  speedUpBtn.disabled = true
  speedDot.className = 'status-dot pending'
  setSpeedMsg(kind === 'download' ? '正在测下载…' : '正在测上传…', '')

  const off = window.api.speed.onSample((s) => {
    speedPoints.push({ tSec: s.tSec, bytes: s.bytes })
    updateSpeedStats(speedPoints)
    drawSpeedCurve(speedPoints, speedMbps)
  })

  try {
    let result
    if (kind === 'download') {
      result = await window.api.speed.download(speedUrl.value.trim())
    } else {
      const url = speedUrl.value.trim()
      const upUrl = /speed\.cloudflare\.com/.test(url)
        ? 'https://speed.cloudflare.com/__up'
        : url
      result = await window.api.speed.upload({ url: upUrl, sizeBytes: 64 * 1024 * 1024 })
    }
    if (result.cancelled) {
      speedDot.className = 'status-dot idle'
      setSpeedMsg('测速已停止。', '')
      return
    }
    // 结果里的采样更完整，用其结果重建曲线与统计（去掉结尾的空采样，避免多一个 0 柱）
    speedPoints.length = 0
    const clean = result.samples.slice()
    while (clean.length && clean[clean.length - 1].bytes === 0) clean.pop()
    for (const s of clean) speedPoints.push({ tSec: s.tSec, bytes: s.bytes })
    if (speedPoints.length) {
      updateSpeedStats(speedPoints)
      drawSpeedCurve(speedPoints, speedMbps)
    }
    speedDot.className = 'status-dot reachable'
    setSpeedMsg(
      `${kind === 'download' ? '下载' : '上传'}测速完成：平均 ${(result.avgBps / 1e6).toFixed(2)} MB/s，共 ${fmtBytes(result.totalBytes)}。`,
      'ok'
    )
  } catch (err) {
    speedDot.className = 'status-dot unreachable'
    setSpeedMsg(`${kind === 'download' ? '下载' : '上传'}测速失败：${errMessage(err)}`, 'err')
  } finally {
    off()
    speedRunning = false
    speedDownBtn.disabled = false
    speedUpBtn.disabled = false
    speedCancelBtn.disabled = true
  }
}

speedDownBtn.addEventListener('click', () => void runSpeed('download'))
speedUpBtn.addEventListener('click', () => void runSpeed('upload'))
speedCancelBtn.addEventListener('click', () => void window.api?.speed.cancel())
speedCancelBtn.disabled = true

init()