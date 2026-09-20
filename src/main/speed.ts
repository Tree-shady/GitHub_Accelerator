import http from 'node:http'
import https from 'node:https'

export interface SpeedSample {
  tSec: number // 距开始的时间（秒）
  bytes: number // 本采样窗口内累计字节数
}
export interface SpeedResult {
  totalBytes: number
  seconds: number
  avgBps: number // 平均速率 字节/秒
  samples: SpeedSample[]
  error?: string
}

export const DEFAULT_DOWNLOAD_URL =
  'https://speed.cloudflare.com/__down?bytes=52428800' // 50MB
export const DEFAULT_UPLOAD_URL = 'https://speed.cloudflare.com/__up'

let activeAbort: (() => void) | null = null

export function cancelSpeedTest(): void {
  try {
    activeAbort?.()
  } catch {
    /* ignore */
  }
  activeAbort = null
}

function launcher(url: string): (typeof https.request) | (typeof http.request) {
  return url.startsWith('http://') ? http.request : https.request
}

const SAMPLE_MS = 1000

function makeSampler(
  startedAt: number,
  onSample: (s: SpeedSample) => void
): {
  samples: SpeedSample[]
  pushBytes: (n: number) => void
  flush: () => void
  stop: () => void
} {
  let winBytes = 0
  const samples: SpeedSample[] = []
  const timer = setInterval(() => {
    const now = Date.now()
    samples.push({ tSec: (now - startedAt) / 1000, bytes: winBytes })
    onSample({ tSec: (now - startedAt) / 1000, bytes: winBytes })
    winBytes = 0
  }, SAMPLE_MS)
  return {
    samples,
    pushBytes(n) {
      winBytes += n
    },
    flush() {
      const now = Date.now()
      samples.push({ tSec: (now - startedAt) / 1000, bytes: winBytes })
      onSample({ tSec: (now - startedAt) / 1000, bytes: winBytes })
      winBytes = 0
    },
    stop() {
      clearInterval(timer)
    }
  }
}

function finalize(
  startSec: number,
  totalBytes: number,
  samples: SpeedSample[]
): SpeedResult {
  const seconds = Date.now() / 1000 - startSec
  return { totalBytes, seconds, avgBps: seconds > 0 ? totalBytes / seconds : 0, samples }
}

export function runDownloadTest(
  url: string,
  onSample: (s: SpeedSample) => void
): Promise<SpeedResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const startSec = startedAt / 1000
    const sampler = makeSampler(startedAt, onSample)
    let total = 0
    let settled = false

    const req = launcher(url)(url, { method: 'GET' })
    activeAbort = () => {
      if (!settled) {
        settled = true
        req.destroy()
        resolve(finalize(startSec, total, sampler.samples))
      }
    }
    req.on('error', (err) => {
      if (settled) return
      settled = true
      sampler.stop()
      activeAbort = null
      reject(new Error('下载失败：' + err.message))
    })
    req.on('response', (res: http.IncomingMessage) => {
      if (!res.statusCode || res.statusCode >= 400) {
        if (settled) return
        settled = true
        sampler.stop()
        activeAbort = null
        reject(new Error('下载失败：HTTP ' + res.statusCode))
        res.resume()
        return
      }
      res.on('data', (chunk) => {
        total += chunk.length
        sampler.pushBytes(chunk.length)
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        sampler.stop()
        sampler.flush()
        activeAbort = null
        resolve(finalize(startSec, total, sampler.samples))
      })
    })
    req.end()
  })
}

export function runUploadTest(
  url: string,
  sizeBytes: number,
  onSample: (s: SpeedSample) => void
): Promise<SpeedResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const startSec = startedAt / 1000
    const sampler = makeSampler(startedAt, onSample)
    let sent = 0
    let settled = false

    const req = launcher(url)(url, {
      method: 'POST',
      headers: {
        'Content-Length': String(sizeBytes),
        'Content-Type': 'application/octet-stream'
      }
    })
    activeAbort = () => {
      if (!settled) {
        settled = true
        req.destroy()
        resolve(finalize(startSec, sent, sampler.samples))
      }
    }
    req.on('error', (err) => {
      if (settled) return
      settled = true
      sampler.stop()
      activeAbort = null
      reject(new Error('上传失败：' + err.message))
    })

    // 分块写入（每块 256KB），在回调里采样，避免一次性分配超大 Buffer
    const CHUNK = 256 * 1024
    const zero = Buffer.alloc(CHUNK)
    function writeNext() {
      if (settled) return
      if (sent >= sizeBytes) {
        req.end()
        return
      }
      const remain = sizeBytes - sent
      const slice = remain < CHUNK ? zero.subarray(0, remain) : zero
      sent += slice.length
      sampler.pushBytes(slice.length)
      const ok = req.write(slice)
      if (ok) {
        writeNext()
      } else {
        req.once('drain', writeNext)
      }
    }
    req.on('response', (res: http.IncomingMessage) => {
      res.resume()
      res.on('end', () => {
        if (settled) return
        settled = true
        sampler.stop()
        sampler.flush()
        activeAbort = null
        resolve(finalize(startSec, sent, sampler.samples))
      })
      res.on('error', (err) => {
        if (!settled) {
          settled = true
          sampler.stop()
          activeAbort = null
          reject(new Error('上传失败：' + err.message))
        }
      })
    })
    writeNext()
  })
}