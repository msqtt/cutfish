# Cutfish

[English](README.md) · [在线体验](https://cutfish.msqt.fun)

Cutfish 是一款由 FFmpeg WebAssembly 驱动、完全运行在浏览器中的隐私视频编辑器。你可以在不上传媒体文件的情况下裁剪、排序和合并多个视频，调整画面、同步音频，并导出 MP4 或 WebM。

## 特性

- **隐私优先**：编辑和渲染全部在浏览器本地完成。
- **多片段工作流**：一次导入多个文件，前后排序、删除、连续预览并合并导出。
- **灵活导出**：选择任意项目时间轴区间，并设置 480p/720p/1080p、24/30/60 fps、紧凑/均衡/高质量，实时预估文件大小。
- **音频兼容合并**：可混合有声和无声视频，需要时会在本地自动生成静音轨。
- **精确编辑**：裁剪起止时间、实时色彩预览，以及前后 5 秒定位。
- **本地草稿**：通过 IndexedDB 保存源 `File` 对象和编辑状态，刷新后可恢复。
- **快速启动**：只有首次发起导出时才加载 FFmpeg 引擎。
- **无障碍与响应式**：支持键盘快捷键、清晰焦点、减少动画、移动端面板、明暗主题和中英文界面。
- **可靠历史**：限制撤销栈长度，连续拖动滑块只生成一条历史记录。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 播放 / 暂停 | `Space` |
| 前后定位 | `←` / `→`（5 秒） |
| 撤销 | `Ctrl/Cmd + Z` |
| 重做 | `Ctrl/Cmd + Shift + Z` 或 `Ctrl/Cmd + Y` |
| 导出 MP4 | `Ctrl/Cmd + E` |
| 删除选中片段 | `Delete` / `Backspace` |

## 环境要求

- Node.js 20.9 或更高版本（Netlify 使用 Node.js 22）
- 较新版本的 Chromium、Firefox 或 Safari

首次导出默认会从 unpkg 下载约 30 MB 的 FFmpeg 核心。如果希望自行托管，可将 `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` 指向包含同版本 `ffmpeg-core.js` 和 `ffmpeg-core.wasm` 的目录。

## 本地开发

```bash
npm install
npm run dev
```

访问 <http://localhost:3000>。项目不需要账号、数据库、服务端媒体处理器或 API Key。

质量检查：

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## 架构

- **Next.js App Router + React**：应用外壳和响应式界面
- **FFmpeg.wasm**：本地裁剪、标准化、拼接、滤镜、音频同步和编码
- **IndexedDB（`idb-keyval`）**：防抖保存本地草稿
- **`lib/` 纯逻辑模块**：FFmpeg 命令和历史状态由 Vitest 覆盖
- **COOP/COEP 响应头**：Next.js 与 Netlify 均配置 WebAssembly 隔离和安全头

媒体文件不会离开设备。应用加载完成后，除 FFmpeg 核心下载外不会发送其他运行时网络请求；自行托管核心后也可消除这一外部请求。

## 部署

`netlify.toml` 已配置 Next.js 自动构建以及所需的隔离/安全响应头。在 Netlify 中连接 GitHub 仓库并部署 `main` 分支后，每次推送都会自动触发生产构建。

生产地址：<https://cutfish.msqt.fun>

## 已知限制

由于 FFmpeg.wasm 在浏览器本地处理媒体，超大项目仍会受到浏览器内存限制。导出速度和编解码兼容性取决于浏览器、设备及 FFmpeg.wasm 构建；文件大小为参考估算，并非精确目标。
