// 将文本中的 GitHub 地址改写到镜像前缀（ghproxy 风格），支持三种常见形式。

// 匹配 github URL 前缀：git@ 冒号形式、git://、http(s)://
const URL_RE =
  /(?:git@github\.com:)([A-Za-z0-9_.\-/]+)|(?:(?:https?:\/\/|git:\/\/)github\.com\/)([A-Za-z0-9_.\-/]+)/g

export function rewriteGitHubUrls(input: string, mirror: string): string {
  const base = mirror.trim().replace(/\/+$/, '')
  if (!base) return input
  return input.replace(URL_RE, (full, sshPath: string | undefined, urlPath: string | undefined) => {
    const path = sshPath ?? urlPath!
    return `${base}/https://github.com/${path}`
  })
}

export function containsGitHubUrl(input: string): boolean {
  return /(?:git@github\.com:|git:\/\/github\.com\/|https?:\/\/github\.com\/)/.test(input)
}