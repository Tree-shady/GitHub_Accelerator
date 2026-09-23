export interface ProxyConfig {
  host: string
  port: number
}

export interface Target {
  name: string
  host: string
  ports: number[]
}

export interface ProbeResult {
  name: string
  host: string
  port: number
  viaProxy: boolean
  connected: boolean
  latencyMs: number
  ip?: string
  remoteIp?: string
  error?: string
}

export interface TargetReport {
  name: string
  host: string
  ports: ProbeResult[]
  best: ProbeResult | null
}

export interface TestOptions {
  targets?: Target[]
  proxy?: ProxyConfig
  timeoutMs?: number
}

export interface HostEntry {
  ip: string
  host: string
}

export interface HostsStatus {
  path: string
  exists: boolean
  admin: boolean
  hasManagedBlock: boolean
  backupPath: string
  backupExists: boolean
}

export type GitProxyScope = 'global' | 'github'

export interface GitConfigEntry {
  key: string
  value: string
}

export interface GitStatus {
  installed: boolean
  version?: string
  entries: GitConfigEntry[]
}

export interface GitApplyOptions {
  host: string
  port: number
  scope: GitProxyScope
  rewriteGit: boolean
}

export interface SpeedSample {
  tSec: number
  bytes: number
}

export interface SpeedResult {
  totalBytes: number
  seconds: number
  avgBps: number
  samples: SpeedSample[]
  error?: string
  cancelled?: boolean
}

export type SpeedDirection = 'download' | 'upload'

// 推送给渲染端的实时采样，带方向标记（下载/上传）
export interface SpeedSampleEvent extends SpeedSample {
  dir: SpeedDirection
}

// 一次「下载 + 上传」综合测速的完整结果
export interface SpeedFullResult {
  download: SpeedResult
  upload: SpeedResult
  cancelled?: boolean
}

export interface SpeedFullOptions {
  downloadUrl?: string
  uploadUrl?: string
  uploadSizeBytes?: number
}