import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const LOG_FILE = 'operation.log'

function logPath(): string {
  return path.join(app.getPath('userData'), LOG_FILE)
}

// 追加一条带时间戳的操作日志（hosts/git 等敏感写入）
export async function logEvent(action: string, detail: string, ok = true): Promise<void> {
  try {
    const line = `[${new Date().toISOString()}] ${ok ? 'OK ' : 'ERR'} ${action} | ${detail}\n`
    await fs.appendFile(logPath(), line, 'utf8')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export async function getLog(): Promise<string> {
  try {
    return await fs.readFile(logPath(), 'utf8')
  } catch {
    return ''
  }
}

export async function clearLog(): Promise<void> {
  try {
    await fs.writeFile(logPath(), '', 'utf8')
  } catch {
    /* ignore */
  }
}