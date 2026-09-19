import net from 'node:net'
import dns from 'node:dns/promises'
import type {
  ProxyConfig,
  Target,
  TargetReport,
  ProbeResult
} from '../shared/types'

export const TARGETS: Target[] = [
  { name: 'github.com', host: 'github.com', ports: [443, 22] },
  { name: 'api.github.com', host: 'api.github.com', ports: [443] },
  { name: 'codeload.github.com', host: 'codeload.github.com', ports: [443] },
  { name: 'raw.githubusercontent.com', host: 'raw.githubusercontent.com', ports: [443] },
  { name: 'objects.githubusercontent.com', host: 'objects.githubusercontent.com', ports: [443] },
  { name: 'github.global.ssl.fastly.net', host: 'github.global.ssl.fastly.net', ports: [443] },
  { name: 'avatars.githubusercontent.com', host: 'avatars.githubusercontent.com', ports: [443] }
]

// 已知可达的 GitHub 网页前端 IP 池。当某域名的 DNS 解析结果被污染/不可达时，
// 用这些已验证可连通的 IP 做兜底探测（hosts 会写入最快命中的那个 IP）。
const WEB_IP_POOL = [
  '20.27.177.113', // 新加坡
  '20.205.243.168',
  '20.201.28.151', // 香港
  '140.82.116.3',
  '140.82.112.3',
  '140.82.113.3',
  '140.82.114.3'
]

// 需要 IP 池兜底的域名 → 候选 IP 列表
const HOST_IP_POOL: Record<string, string[]> = {
  'github.com': WEB_IP_POOL
}

async function resolveIp(host: string): Promise<string | undefined> {
  try {
    const { address } = await dns.lookup(host, { family: 4 })
    return address
  } catch {
    return undefined
  }
}

function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
  proxy?: ProxyConfig,
  connectIp?: string
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    let settled = false

    const settle = (result: Omit<ProbeResult, 'name' | 'host' | 'port' | 'viaProxy'>): void => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve({ name: host, host, port, viaProxy: !!proxy, ...result })
    }

    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => settle({ connected: false, latencyMs: timeoutMs, error: '连接超时' }))
    socket.once('error', (err) =>
      settle({ connected: false, latencyMs: Date.now() - start, error: err.message })
    )

    if (!proxy) {
      socket.once('connect', () =>
        settle({
          connected: true,
          latencyMs: Date.now() - start,
          remoteIp: connectIp || socket.remoteAddress
        })
      )
      socket.connect(port, connectIp || host)
      return
    }

    // 通过 HTTP CONNECT 代理做连通性探测
    socket.once('connect', () => {
      const buf = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`
      socket.write(buf)
    })
    socket.on('data', (chunk) => {
      const text = chunk.toString()
      if (/^HTTP\/1\.[01] 2\d\d/.test(text)) {
        settle({ connected: true, latencyMs: Date.now() - start })
      } else {
        settle({
          connected: false,
          latencyMs: Date.now() - start,
          error: `代理拒绝：${text.split('\r\n')[0]}`
        })
      }
    })
    socket.connect(proxy.port, proxy.host)
  })
}

export async function runConnectivityTest(
  targets: Target[] = TARGETS,
  timeoutMs = 3000,
  proxy?: ProxyConfig
): Promise<TargetReport[]> {
  const hostSet = new Map<string, string>()
  for (const t of targets) hostSet.set(t.host, t.host)

  // 并行解析一次所有目标 IP（直连模式下复用，展示给用户）
  const ipMap = new Map<string, string | undefined>()
  if (!proxy) {
    await Promise.all(
      [...hostSet.values()].map(async (h) => {
        ipMap.set(h, await resolveIp(h))
      })
    )
  }

  const reports = await Promise.all(
    targets.map(async (t) => {
      const baseIp = proxy ? undefined : ipMap.get(t.host)

      // 组装候选连接地址：直连优先用 DNS IP，随后用域名的 IP 池兜底
      const connectJobs: Array<{ connectIp?: string; labelIp: string | undefined }> = []
      if (proxy) {
        connectJobs.push({ connectIp: undefined, labelIp: undefined })
      } else {
        if (baseIp) connectJobs.push({ connectIp: baseIp, labelIp: baseIp })
        for (const pip of HOST_IP_POOL[t.host] || []) {
          if (baseIp && pip === baseIp) continue
          connectJobs.push({ connectIp: pip, labelIp: pip })
        }
        // 无 DNS 也无池时，退化为主机名直接连接
        if (connectJobs.length === 0) connectJobs.push({ connectIp: undefined, labelIp: undefined })
      }

      const results: ProbeResult[] = []
      for (const job of connectJobs) {
        const per = await Promise.all(
          t.ports.map((port) => tcpProbe(t.host, port, timeoutMs, proxy, job.connectIp))
        )
        results.push(...per)
      }

      const withIp = results.map((r) => ({ ...r, ip: r.remoteIp || baseIp }))
      const connected = withIp.filter((r) => r.connected)
      const best = connected.length
        ? connected.reduce((a, b) => (a.latencyMs <= b.latencyMs ? a : b))
        : null
      return { name: t.name, host: t.host, ports: withIp, best }
    })
  )
  return reports
}