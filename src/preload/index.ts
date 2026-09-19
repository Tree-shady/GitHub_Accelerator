import { contextBridge, ipcRenderer } from 'electron'
import type {
  GitApplyOptions,
  GitConfigEntry,
  GitProxyScope,
  GitStatus,
  HostEntry,
  HostsStatus,
  ProxyConfig,
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
  }
}

export type { GitConfigEntry }

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)