import { contextBridge, ipcRenderer } from 'electron'
import type {
  GitApplyOptions,
  GitConfigEntry,
  GitProxyScope,
  GitStatus,
  HostEntry,
  HostsStatus,
  ProxyConfig,
  SpeedResult,
  SpeedSample,
  Target,
  TargetReport
} from '../shared/types'

const api = {
  testConnectivity: (options: {
    targets?: Target[]
    proxy?: ProxyConfig
    timeoutMs?: number
  }): Promise<TargetReport[]> => ipcRenderer.invoke('connectivity:test', options),
  getTargets: (): Promise<Target[]> => ipcRenderer.invoke('connectivity:targets'),
  hosts: {
    status: (): Promise<HostsStatus> => ipcRenderer.invoke('hosts:status'),
    apply: (entries: HostEntry[]): Promise<{
      entries: HostEntry[]
      wrote: boolean
      elevated: boolean
      backupPath: string
    }> => ipcRenderer.invoke('hosts:apply', entries),
    revert: (): Promise<{ removed: boolean; elevated: boolean }> =>
      ipcRenderer.invoke('hosts:revert')
  },
  git: {
    status: (): Promise<GitStatus> => ipcRenderer.invoke('git:status'),
    apply: (options: GitApplyOptions): Promise<{ applied: string[] }> =>
      ipcRenderer.invoke('git:apply', options),
    clear: (scope: GitProxyScope): Promise<{ cleared: string[] }> =>
      ipcRenderer.invoke('git:clear', scope),
    clearAll: (): Promise<{ cleared: string[] }> => ipcRenderer.invoke('git:clearAll')
  },
  clipboard: {
    read: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
    write: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text)
  },
  // IP 池维护
  ippool: {
    get: (): Promise<string[]> => ipcRenderer.invoke('ippool:get'),
    set: (ips: string[]): Promise<string[]> => ipcRenderer.invoke('ippool:set', ips)
  },
  // 操作日志
  log: {
    get: (): Promise<string> => ipcRenderer.invoke('log:get'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('log:clear'),
    export: (name?: string): Promise<{ canceled: boolean; filePath?: string }> =>
      ipcRenderer.invoke('log:export', name)
  },
  // 测速（下载/上传 + 实时采样）
  speed: {
    download: (url?: string): Promise<SpeedResult> => ipcRenderer.invoke('speed:download', url),
    upload: (opts?: { url?: string; sizeBytes?: number }): Promise<SpeedResult> =>
      ipcRenderer.invoke('speed:upload', opts),
    cancel: (): Promise<boolean> => ipcRenderer.invoke('speed:cancel'),
    onSample: (cb: (s: SpeedSample) => void): (() => void) => {
      const listener = (_e: unknown, s: SpeedSample): void => cb(s)
      ipcRenderer.on('speed:sample', listener)
      return () => {
        ipcRenderer.removeListener('speed:sample', listener)
      }
    }
  }
}

export type { GitConfigEntry }

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)