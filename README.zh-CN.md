# Cutfish 🐟

**隐私优先、基于浏览器的视频编辑器，由 FFmpeg WebAssembly 驱动。**

所有处理在本地完成——您的媒体文件永远不会离开您的设备。

## 功能特性

- **多文件导入**：拖放、重复检测、进度追踪
- **逐片段裁剪**：0.01 秒精度，分割、复制、重排序、内联重命名
- **逐片段音量/静音**（0–200%）与主音量控制；预览反映片段×主音量（上限 1.0）
- **逐片段速度**（0.25×–4.0×）速度感知的时间轴、时长、导出范围映射
- **逐片段旋转**（0/90/180/270°）与水平/垂直翻转
- **画布比例**（16:9、9:16、4:3、1:1、自动）与适应/覆盖/拉伸模式；预览实时反映画布比例和填充模式
- **片段间转场**（淡入淡出、溶解、擦除、滑动变体）可配置时长；混合有/无转场链生成有效 FFmpeg 滤镜图
- **文字叠加**：字体、大小、颜色、位置、时间——实时预览与 FFmpeg 导出（内置 DejaVu Sans、Serif 与 Sans Mono 字体，写入 MEMFS）
- **字幕**：多行文本（手动换行 + 按 cue.width 自动按词/字符换行）、位置 x/y、宽度、字体/字号/行高、颜色/可透明背景（带清除按钮）、对齐、旋转、起止时间（数值钳制且 end>start）；按当前项目帧时间插入；导出时渲染为全画布透明 PNG（OffscreenCanvas，加载 DejaVu 字体 fail-fast），通过 FFmpeg overlay 滤镜烧录（shortest=1/eof_action=pass）
- **浏览器 TTS 预览**：逐字幕启用，语音/语言选择，语速/音调/音量；播放进入 cue 自动朗读（空文本不读），离开 cue/暂停/切项目/卸载时 cancel；检测 speechSynthesis + SpeechSynthesisUtterance，不支持时禁用即时自动预览并显示提示；浏览器 speechSynthesis 仅用于时间轴即时预览
- **可导出的本地 TTS**：逐字幕选择导出音色（Piper VITS 中文/英文，20–65 MB 模型），包含导出开关（默认开启），语速/音量控制；模型首次使用从外部 CDN 下载后缓存在浏览器 OPFS，所有推理完全本地运行；试听按钮播放实际生成 WAV（与导出一致）；生成语音通过 FFmpeg amix 烧录进最终音轨；字幕文本和媒体永远不会被上传
- **视觉标注**（画笔、矩形、图片）：画笔在预览上自由绘制并实时显示草稿线条；矩形工具拖拽绘制并实时虚线预览；图片导入在当前帧时间插入；支持 x/y、宽高、旋转、不透明度、时间范围（钳制 end>start）、描边/填充/线宽；绘制模式 touch-action:none，处理 pointercancel/lostpointercapture 防止卡住；画笔坐标使用 rebaseDrawingPoints 转为 bounds 内局部 0..1 坐标，预览/导出一致
- **透明 PNG 渲染器**：字幕 + 视觉标注均通过 `selectAndShiftOverlaysForExport` 裁剪导出范围，渲染为全分辨率 PNG，写入 MEMFS 传递给 `buildFFmpegCommandExtended`，overlay 链使用 `shortest=1:eof_action=pass`；字体/图片加载失败 fail-fast；导出后清理临时文件
- **图片标注持久化**：File 存入 IndexedDB（结构化克隆），url 仅运行时（加载项目时从 File 重建）；删除不立即 revoke（保留 undo）；项目切换/teardown 统一撤销所有 tracked URL
- **可编辑音频轨（A1）**：一个背景音频源 + 多个可独立编辑的时间轴片段，每个片段拥有各自的项目起点、源裁剪（起点/终点）、音量、淡入/淡出；支持导入或替换音频源、在项目播放头处分割片段、删除片段。旧版单背景音乐草稿会自动迁移为一个片段；缺少时长元数据的音轨会从本地文件异步补齐。File 持久化在 IndexedDB 中（切换项目时恢复 URL）；可选择与视频原声混音，或移除全部视频原声并以背景音乐替换，同时保留字幕 TTS
- **全局滤镜**（亮度、对比度、饱和度）实时 CSS 预览
- **音频同步**调整（±5000ms）与全局淡入/淡出
- **项目范围导出**：速度感知时长，分辨率（480p–1080p）、帧率（24/30/60）、质量预设
- **一键预设**（社交短视频、YouTube、快速分享、电影感）+ 自定义命名预设保存/应用/删除（localStorage）
- **多项目管理**（创建、切换、重命名、复制、删除）IndexedDB 持久化；切换/新建/删除前强制保存防止数据竞争
- **旧版迁移**：从 v1 单项目到 v2 多项目格式
- **双轨时间轴**：V1 视频轨（缩放控制、可拖动播放头、自动跟随、速度感知宽度、拖动排序）+ 与项目时间对齐的 A1 音频轨。音频块可点击选中，可横向拖动改变项目起点（以项目时间而非像素持久化），并支持方向键微调（0.1 秒，按住 Shift 为 1 秒）；一次完整拖动或连续微调会合并为单个撤销检查点。面板可折叠并自适应容纳双轨；转场减少总时长时同时显示编辑时长和输出时长
- **检查器**：标签式 UI（片段、项目、音频、效果）与固定导出按钮；移动端为底部弹出面板
- **全屏预览**（F 键或按钮）按住比较原始/滤镜画面
- **快捷键**：`?` 帮助模态框，焦点捕获，打开时自动聚焦
- **本地化的最近保存时间戳**在保存状态指示器中
- **撤销/重做**（50 级有界历史）；删除片段不撤销 URL，保留撤销能力
- **深色/浅色/系统主题**，中英文 i18n
- **响应式设计**：移动端底部弹出检查器，可访问关闭
- **统一 UI 系统**：紧凑文字不低于 12px，主要操作和标题使用 14px，表单与图标点击区统一到 36px，完整焦点状态、移动端更大触控区域，以及 16px 移动输入字号防止浏览器自动缩放
- **编辑交互优化**：检查器采用 ARIA 标签语义与方向键导航、窄屏标签横向滚动、标注工具显示按下状态、滑杆取消时安全结束编辑、独立的键盘/触摸播放头拖柄，移动时间轴可正常横向滑动
- **无障碍**（ARIA 标签、键盘导航、焦点管理、实时区域、片段操作折叠菜单、无嵌套交互元素）
- **零外部依赖**——初次加载后完全离线运行

## 快速开始

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm test` | 运行单元测试（Vitest） |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 检查 |

## 技术栈

- **框架**：Next.js 16（App Router，静态导出）
- **视频引擎**：FFmpeg.wasm 0.12（导出时延迟加载）
- **状态**：React Hooks + 纯有界历史
- **持久化**：IndexedDB via idb-keyval（File 结构化克隆）
- **样式**：Tailwind CSS 4
- **国际化**：i18next + react-i18next（中/英文）
- **图标**：Lucide React
- **部署**：Netlify（静态 + 边缘）

## 架构

```
components/Editor.tsx      – 主编排器，标签式检查器、项目管理器、所有模态框
components/ExportPanel.tsx – 导出范围/质量/大小模态框内容
components/Timeline.tsx    – 可缩放时间轴，可拖动播放头，自动跟随
lib/editor-utils.ts        – 纯片段操作与速度感知时间映射
lib/ffmpeg-utils.ts        – FFmpeg 命令构建器（基础 + 扩展全功能，PNG overlay 使用 shortest=1/eof_action=pass）
lib/transition-utils.ts    – xfade/acrossfade 滤镜链
lib/text-overlay-utils.ts  – drawtext + PNG 叠加构建器
lib/visual-overlay-utils.ts – SubtitleCue/VisualOverlay 类型、工厂、selectAndShiftOverlaysForExport、rebaseDrawingPoints
lib/overlay-renderer.ts    – 浏览器端透明 PNG 渲染器（OffscreenCanvas），字幕 + 视觉标注
lib/tts-utils.ts           – Piper 语音列表、TTS 配置规范化、缓存 key、导出 cue 选择
lib/local-tts.ts           – 浏览器 VITS 合成封装（动态导入、OPFS 模型缓存）
lib/preset-utils.ts        – 预设定义与应用器
lib/draft-store.ts         – 多项目 IndexedDB CRUD 与迁移
lib/history.ts             – 有界撤销/重做
lib/i18n.ts                – 中英文翻译资源
```

## 导出流水线

导出使用 `buildFFmpegCommandExtended`，处理流程：
1. 逐片段：裁剪 → 速度 → 旋转/翻转 → 缩放/填充 → 音量
2. 转场：xfade/acrossfade（或简单拼接）
3. 全局：亮度/对比度/饱和度 EQ
4. 文字叠加：drawtext 滤镜（遗留 TextOverlay 对象）
5. 字幕 + 视觉标注：通过 OffscreenCanvas 渲染为全画布透明 PNG → `overlay=0:0:shortest=1:eof_action=pass:enable='between(t,...)'`
6. TTS：启用的字幕通过本地 Piper VITS 合成 WAV（模型缓存在 OPFS），写入 MEMFS，通过 atrim→atempo→volume→adelay→amix 混音
7. 音频：原声同步/淡入淡出 → 背景音乐混音，或丢弃原声 + 补齐时长的背景音乐替换 → 可选字幕 TTS 混音

字幕渲染为透明 PNG（非 drawtext），支持手动换行、自动按词/字符换行（基于 cue.width）、fontFamily、fontSize、lineHeight、color、可透明背景、align、position、rotation。视觉标注（画笔/矩形/图片）同样渲染为 PNG。所有 PNG overlay 使用 `shortest=1:eof_action=pass` 确保主视频结束时正确终止。

TTS 音频使用 Piper ONNX（通过 `@diffusionstudio/vits-web`）在本地生成。语音模型（20–65 MB）首次使用时从公共 CDN 下载，随后缓存在浏览器 Origin Private File System 中。所有推理完全在浏览器内完成。字幕文本和媒体永远不会被上传。

## 许可证

私有项目，保留所有权利。
