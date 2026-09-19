# GitHub 加速器

GitHub 连通性检测与加速桌面工具（Electron）。当 GitHub 无法正常访问（DNS 污染、SNI 阻断等）时，帮你诊断网络状况，并通过多种方案恢复/提升访问速度。

## 功能

- **连通性检测**：通过 TCP 建连探测关键域名的可达性与延迟（支持直连或经 HTTP 代理），逐端口列出建连结果并给出综合评级。
- **Hosts 一键加速**：用检测结果里实际的建连 IP 写入 hosts，绕过被污染的 DNS 解析。写入前自动备份，可一键还原（Windows 下需管理员权限时自动触发 UAC 提权）。
- **Git 代理配置**：为 git 写入代理配置（`~/.gitconfig`），可选全局生效或仅对 GitHub 生效，并可把 `git://` 协议改写为 `https://`，以及一键清除相关配置。
- **URL 镜像改写加速**：把 GitHub 链接改写到镜像前缀（ghproxy 风格）便于加速拉取，支持 `https://`、`git://`、`git@github.com:` 三种写法，改写好自动复制到剪贴板。

> 隐私提示：URL 镜像改写会把链接转发到第三方镜像服务器，请只用于公开仓库，切勿粘贴私有仓库或含凭据/令牌的地址。

## 技术栈

- [Electron](https://www.electronjs.org/) 33 + [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/)
- TypeScript、Vite
- 分层架构：main / preload / renderer 三进程，通过 `contextBridge` + `contextIsolation` 安全地暴露 IPC，renderer 侧启用 CSP。

```
src/
├── main/       主进程：连通性检测、hosts 读写、git 配置、剪贴板
│   ├── connectivity.ts
│   ├── hosts.ts
│   ├── git.ts
│   └── index.ts
├── preload/    预加载：contextBridge 暴露 window.api
│   └── index.ts
├── renderer/   渲染进程：UI 与交互逻辑
│   └── src/
│       ├── main.ts
│       ├── rewrite.ts   Git 链接改写
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

# 生成便携版（无需安装）
npm run dist:portable
```

> 设置安装包需要 `build/elevate-copy.exe`（用于提权写 hosts），请确保该文件存在；图标位于 `build/icon.png`。

## 说明

- 检测基于 TCP 建连完成，结果用于判断网络连通状况。
- hosts 管理段由本工具标记管理，请勿手动编辑/删除该区间；如需还原，使用应用内的「还原」按钮。
- 触发管理员权限写入 hosts 时，会校验当前进程的写权限，无权限时通过 UAC 提权子进程完成写入。

## License

MIT