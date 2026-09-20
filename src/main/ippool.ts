import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

// 用户自定义的 GitHub 前端 IP 池，持久化到 userData，供检测兜底与界面维护。
const FILE = 'ip-pool.json'

interface PoolFile {
  custom: string[]
}

async function readPool(): Promise<PoolFile> {
  try {
    const raw = await fs.readFile(path.join(app.getPath('userData'), FILE), 'utf8')
    const data = JSON.parse(raw) as PoolFile
    if (Array.isArray(data.custom)) return { custom: data.custom }
  } catch {
    /* 不存在或损坏时使用默认 */
  }
  return { custom: [] }
}

export async function getCustomIps(): Promise<string[]> {
  const pool = await readPool()
  return pool.custom.filter(isIpV4)
}

export async function setCustomIps(ips: string[]): Promise<string[]> {
  const cleaned = [...new Set(ips.map((s) => s.trim()).filter(isIpV4))]
  await fs.writeFile(
    path.join(app.getPath('userData'), FILE),
    JSON.stringify({ custom: cleaned }, null, 2),
    'utf8'
  )
  return cleaned
}

function isIpV4(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255)
}