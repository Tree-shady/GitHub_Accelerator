# GitHub 加速器

GitHub 连通性检测与加速桌面工具（Electron）。当 GitHub 无法正常访问（DNS 污染、SNI 阻断等）时，帮你诊断网络状况，并通过多种方案恢复/提升访问速度。

## 功能

- **连通性检测**：通过 TCP 建连并发探测关键域名的可达性与延迟（支持直连或经 HTTP 代理）。同一端口多 IP 时取“已连通”结果展示，避免被失败首条误导。
- **Hosts 一键加速**：用检测到的实际建连 IP 写入 hosts，绕过被污染的 DNS 解析。内置常用 GitHub 网页 IP 池，检测失败时自动兜底取最快连通 IP。写入前自动备份，可一键还原；Windows 下无写权限时调用带 `requireAdministrator` 清单的辅助程序触发 UAC 提权。
- **GitHub IP 池自定义 / 刷新**：可添加、保存自选 IP，检测时自动并入兜底池，IP 失效后不再受限于内置值。
- **一键诊断并加速**：一次完成 直连检测 → 选最快 IP → 应用 hosts。
- **Git 代理配置**：为 git 写入代理配置（`~/.gitconfig`），可选全局生效或仅对 GitHub 生效，可把 `git://` 协议改写为 `https://`，并可一键清除。
- **URL 镜像改写加速**：把 GitHub 链接改写到镜像前缀（如 `gh-proxy.com`）便于加速拉取，支持 `https://`、`git://`、`git@github.com:` 三种写法，改写好自动复制到剪贴板。
- **加速测速 + 流量统计**：对下载/上传进行真实测速（默认 Cloudflare，可改镜像 / raw 地址），实时绘制速率曲线，并统计当前/平均速率、已用流量与时长。
- **操作日志**：hosts 应用/还原、git 代理配置等敏感操作会记录，支持查看、导出、清空。

> 隐私提示：URL 镜像改写会把链接转发到第三方镜像服务器，请只用于公开仓库，切勿粘贴私有仓库或含凭据/令牌的地址。

## 技术栈

- [Electron](https://www.electronjs.org/) 33 + [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/)
- TypeScript、Vite
- 分层架构：main / preload / renderer 三进程，通过 `contextBridge` + `contextIsolation` 安全地暴露 IPC，renderer 侧启用 CSP；单实例锁、窗口尺寸/位置记忆。

```
src/
├── main/       主进程：连通性检测、hosts 读写、git 配置、IP 池、测速、日志、剪贴板
│   ├── connectivity.ts  连通性检测（并发探测 + IP 池兜底）
│   ├── hosts.ts           hosts 读写 / 备份 / 还原 / UAC 提权
│   ├── git.ts             git 代理配置
│   ├── ippool.ts          GitHub IP 池
│   ├── speed.ts           加速测速与流量统计
│   ├── logger.ts          操作日志
│   └── index.ts           IPC 入口、单实例、窗口管理
├── preload/    预加载：contextBridge 暴露 window.api
│   └── index.ts
├── renderer/   渲染进程：UI 与交互逻辑
│   └── src/
│       ├── main.ts
│       ├── rewrite.ts   Git 链接改写
│       ├── env.d.ts
│       └── style.css
└── shared/     共享类型定义
    └── types.ts
```

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式（带热更新）
npm run dev

# 类型检查
npm run typecheck

# 构建产物（out/）
npm run build

# 预览构建产物
npm run preview
```

## 打包发布

```bash
# 生成 NSIS 安装包（release/ 目录）
npm run dist

# 生成单文件便携版（无需安装）
npm run dist:portable
```

> 两个命令均走 `scripts/package-win.js` 包装：自动以 `--use-system-ca` 启动并内置国内镜像源（electron / electron-builder-binaries），规避本机 TLS 中间证书与境外下载不稳定问题。

**代码签名（可选，推荐）**：将签名证书放入被 git 忽略的 `cert/` 目录，并在 `cert/env` 中填写私钥密码：

```powershell
cert\
├── your-cert.pfx     # 代码签名证书
└── env               # 一行：CSC_KEY_PASSWORD=你的密码
```

之后直接 `npm run dist` 即会对 `elevate-copy.exe`、主程序、安装包一并签名并逐一校验。也可不落地文件，直接设 `CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量。未配置证书时按未签名模式打包（部分杀软会误报）。

## 提权辅助程序（elevate-copy.exe）

写 hosts 时需要管理员权限：应用通过 `build/elevate-copy.exe`（带 `requireAdministrator` 清单）触发 UAC 提权后复制文件，避免脚本注入以降低杀软误报。

- 源码：`build/elevate-copy.cs`；清单：`build/elevate-copy.manifest`。
- 若该文件缺失或需重新编译，请在本机执行：

```powershell
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc -nologo -platform:anycpu -target:winexe `
  -win32manifest:"E:\GitHub_Accelerator\build\elevate-copy.manifest" `
  -out:"E:\GitHub_Accelerator\build\elevate-copy.exe" `
  "E:\GitHub_Accelerator\build\elevate-copy.cs"
```

> 复制到 hosts 被占用/只读时会自动回退为 `FileShare.ReadWrite` 覆盖写入，并重试 3 次以越过杀软等瞬时锁文件；主进程侧会自动重试并输出带退出码与具体原因的诊断信息。

## 说明

- 检测基于 TCP 建连完成，结果用于判断网络连通状况。
- hosts 管理段由本工具标记管理，请勿手动编辑/删除该区间；如需还原，使用应用内的「还原」按钮。
- 触发管理员权限写入 hosts 时，会先尝试直接写入，无权限时通过 UAC 提权完成。
- 操作日志默认保存在应用 userData 目录，可在界面「日志」卡片导出。
- 项目通过行为白名单的 `cert/`、`*.pfx`、`.env*` 忽略规则保护签名证书与私钥，切勿将证书提交到仓库。

## License

MIT