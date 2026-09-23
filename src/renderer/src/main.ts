import './style.css'
import type {
  GitConfigEntry,
  GitProxyScope,
  GitStatus,
  HostEntry,
  HostsStatus,
  ProxyConfig,
  SpeedDirection,
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
    // 启动加速后自动测速（下载 + 上传双折线）
    void runFullSpeed()
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
    // 一键加速成功后自动测速（下载 + 上传双折线）
    void runFullSpeed()
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

/* ===================== 加速测速（下载 / 上传 双折线） ===================== */
const speedDot = document.getElementById('speedDot') as HTMLElement
const speedRunBtn = document.getElementById('speedRunBtn') as HTMLButtonElement
const speedCancelBtn = document.getElementById('speedCancelBtn') as HTMLButtonElement
const speedUrl = document.getElementById('speedUrl') as HTMLInputElement
const speedNow = document.getElementById('speedNow') as HTMLElement
const speedDownAvg = document.getElementById('speedDownAvg') as HTMLElement
const speedUpAvg = document.getElementById('speedUpAvg') as HTMLElement
const speedDownTotal = document.getElementById('speedDownTotal') as HTMLElement
const speedUpTotal = document.getElementById('speedUpTotal') as HTMLElement
const speedTime = document.getElementById('speedTime') as HTMLElement
const speedCanvas = document.getElementById('speedCanvas') as HTMLCanvasElement
const speedMsg = document.getElementById('speedMsg') as HTMLElement

interface SpeedPoint {
  tSec: number
  bytes: number
}

const DOWN_COLOR = '#3b82f6'
const UP_COLOR = '#f59e0b'

let speedRunning = false
let speedPhase: SpeedDirection | null = null
const downPoints: SpeedPoint[] = []
const upPoints: SpeedPoint[] = []

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

// 某条采样对应的瞬时速率：按与上一条采样的真实时间差折算（采样间隔约 1s）
function pointRate(series: SpeedPoint[], i: number): number {
  const dt = i > 0 ? series[i].tSec - series[i - 1].tSec : 1
  return series[i].bytes / Math.max(0.001, dt)
}

function niceCeil(v: number): number {
  if (v <= 1) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return nice * mag
}

function drawSpeedChart(): void {
  const ctx = speedCanvas.getContext('2d')!
  const w = speedCanvas.width
  const h = speedCanvas.height
  ctx.clearRect(0, 0, w, h)

  const padL = 44
  const padR = 14
  const padT = 12
  const padB = 22
  const plotW = w - padL - padR
  const plotH = h - padT - padB

  const downRates = downPoints.map((_, i) => pointRate(downPoints, i))
  const upRates = upPoints.map((_, i) => pointRate(upPoints, i))
  const yMax = niceCeil(Math.max(1, ...downRates, ...upRates))
  const n = Math.max(downPoints.length, upPoints.length)

  // 横向网格 + Y 轴刻度（MB/s）
  ctx.strokeStyle = '#1e293b'
  ctx.fillStyle = '#8b97ad'
  ctx.font = '10px sans-serif'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(w - padR, y)
    ctx.stroke()
    ctx.fillText(`${((yMax * i) / 4 / 1e6).toFixed(1)}`, 4, y - 3)
  }

  // 纵向网格 + X 轴秒标（点太多时间隔标注，避免文字重叠）
  if (n > 0) {
    const xAt = (i: number): number =>
      padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1))
    const step = n <= 12 ? 1 : Math.ceil(n / 8)
    ctx.textAlign = 'center'
    for (let i = 0; i < n; i += step) {
      const x = xAt(i)
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, padT + plotH)
      ctx.stroke()
      ctx.fillText(`${i + 1}s`, x, h - 6)
    }
    ctx.textAlign = 'start'
  }

  // 折线（速率曲线），带圆点；下载线下方加淡色面积
  function drawLine(rates: number[], color: string, fill: boolean): void {
    if (!rates.length) return
    const xAt = (i: number): number =>
      padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1))
    const yAt = (rate: number): number => padT + plotH - (plotH * rate) / yMax

    if (fill) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
      grad.addColorStop(0, 'rgba(59,130,246,0.22)')
      grad.addColorStop(1, 'rgba(59,130,246,0.01)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(xAt(0), padT + plotH)
      rates.forEach((r, i) => ctx.lineTo(xAt(i), yAt(r)))
      ctx.lineTo(xAt(rates.length - 1), padT + plotH)
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    rates.forEach((r, i) => {
      const x = xAt(i)
      const y = yAt(r)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    ctx.fillStyle = color
    for (let i = 0; i < rates.length; i++) {
      ctx.beginPath()
      ctx.arc(xAt(i), yAt(rates[i]), 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawLine(downRates, DOWN_COLOR, true)
  drawLine(upRates, UP_COLOR, false)
}

function seriesStats(series: SpeedPoint[]): { total: number; avg: number } {
  const total = series.reduce((a, p) => a + p.bytes, 0)
  const lastT = series.length ? series[series.length - 1].tSec : 0
  return { total, avg: lastT > 0 ? total / lastT : 0 }
}

function updateSpeedStats(): void {
  const active = speedPhase === 'upload' ? upPoints : downPoints
  const last = active.length ? active[active.length - 1] : null
  speedNow.textContent = last ? `${speedPhase === 'upload' ? '↑' : '↓'} ${fmtRate(pointRate(active, active.length - 1))}` : '–'

  const down = seriesStats(downPoints)
  const up = seriesStats(upPoints)
  speedDownAvg.textContent = down.avg > 0 ? fmtRate(down.avg) : '–'
  speedUpAvg.textContent = up.avg > 0 ? fmtRate(up.avg) : '–'
  speedDownTotal.textContent = down.total > 0 ? fmtBytes(down.total) : '–'
  speedUpTotal.textContent = up.total > 0 ? fmtBytes(up.total) : '–'

  const t = last ? last.tSec : 0
  speedTime.textContent = t > 0 ? `${t.toFixed(1)} s` : '–'
}

function resetSpeedView(): void {
  for (const el of [
    speedNow,
    speedDownAvg,
    speedUpAvg,
    speedDownTotal,
    speedUpTotal,
    speedTime
  ])
    el.textContent = '–'
  drawSpeedChart()
}

// 综合测速：先下载、后上传，采样实时推送并绘制双折线
async function runFullSpeed(): Promise<void> {
  if (!window.api || speedRunning) return
  speedRunning = true
  speedPhase = 'download'
  downPoints.length = 0
  upPoints.length = 0
  speedRunBtn.disabled = true
  speedCancelBtn.disabled = false
  speedDot.className = 'status-dot pending'
  setSpeedMsg('加速已启动，正在测速：下载阶段…', '')
  resetSpeedView()

  const off = window.api.speed.onSample((s) => {
    const series = s.dir === 'upload' ? upPoints : downPoints
    series.push({ tSec: s.tSec, bytes: s.bytes })
    speedPhase = s.dir
    updateSpeedStats()
    drawSpeedChart()
    if (s.dir === 'upload') setSpeedMsg('下载完成，正在测速：上传阶段…', '')
  })

  try {
    const res = await window.api.speed.full({ downloadUrl: speedUrl.value.trim() })
    if (res.cancelled) {
      speedDot.className = 'status-dot idle'
      setSpeedMsg('测速已停止。', '')
      return
    }
    // 用完整结果重建两条曲线（去掉结尾空采样，避免末尾掉到 0）
    const fillSeries = (target: SpeedPoint[], raw: { tSec: number; bytes: number }[]): void => {
      const clean = raw.slice()
      while (clean.length && clean[clean.length - 1].bytes === 0) clean.pop()
      target.length = 0
      target.push(...clean)
    }
    fillSeries(downPoints, res.download.samples)
    fillSeries(upPoints, res.upload.samples)
    updateSpeedStats()
    drawSpeedChart()
    speedDot.className = 'status-dot reachable'
    setSpeedMsg(
      `测速完成：下载平均 ${fmtRate(res.download.avgBps)}，上传平均 ${fmtRate(res.upload.avgBps)}。`,
      'ok'
    )
  } catch (err) {
    speedDot.className = 'status-dot unreachable'
    setSpeedMsg(`测速失败：${errMessage(err)}`, 'err')
  } finally {
    off()
    speedRunning = false
    speedPhase = null
    speedRunBtn.disabled = false
    speedCancelBtn.disabled = true
  }
}

speedRunBtn.addEventListener('click', () => void runFullSpeed())
speedCancelBtn.addEventListener('click', () => void window.api?.speed.cancel())
speedCancelBtn.disabled = true

init()