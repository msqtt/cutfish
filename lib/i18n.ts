import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      app_title: 'Cutfish', wasm_powered: 'Private · WASM', upload_media: 'Import videos',
      drop_here: 'Drop one or more videos here, or click to browse', media_assets: 'Media assets',
      import: 'Import', no_assets: 'No videos yet. Import files to begin.', inspector: 'Inspector',
      preview: 'Preview', trim: 'Trim', trim_start: 'Start', trim_end: 'End', filters: 'Filters',
      global: 'Global', audio: 'Audio', audio_sync: 'Audio sync', fade_in: 'Fade in', fade_out: 'Fade out',
      fade_hint: 'Applied on export and limited to the selected project range duration.',
      brightness: 'Brightness', contrast: 'Contrast',
      saturation: 'Saturation', export: 'Export', exporting: 'Rendering video…', loading_engine: 'Loading local engine…',
      cancel: 'Cancel', success: 'Your video is ready.', error: 'Export failed. Try a shorter range or a lower quality preset.',
      preparing_media: 'Preparing and inspecting media…',
      engine_error: 'Could not load the local video engine.', light_mode: 'Use light theme', dark_mode: 'Use dark theme',
      undo: 'Undo', redo: 'Redo', delete: 'Delete', move_left: 'Move earlier', move_right: 'Move later',
      no_media: 'No media loaded', auto_saved: 'Saved locally', auto_save: 'Local draft enabled',
      play: 'Play', pause: 'Pause', back_five: 'Back 5 seconds', forward_five: 'Forward 5 seconds',
      video_track: 'Video track', audio_track: 'Audio track', active_trim: 'Active trim', no_clip: 'No clip selected',
      export_mp4: 'Export MP4', export_webm: 'Export WebM', invalid_file: 'Choose at least one valid video file.',
      restored: 'Local draft restored.', close: 'Close panel', language: 'Switch language', duration: '{{value}} seconds',
      full_project: 'Full project', export_range: 'Project export range', range_start: 'Export start', range_end: 'Export end',
      selected_duration: '{{value}} seconds selected', resolution: 'Resolution', frame_rate: 'Frame rate', quality: 'Quality / size',
      quality_compact: 'Compact · smallest file', quality_balanced: 'Balanced · recommended', quality_high: 'High · largest file',
      video_bitrate: 'Target video bitrate', estimated_size: 'Estimated size',
      size_disclaimer: 'Estimate varies with the source and codec. Higher resolution, frame rate, and quality take longer.',
      project_duration: 'Project {{value}}s', draft_error: 'The local draft could not be saved. Browser storage may be full.',
    },
  },
  zh: {
    translation: {
      app_title: 'Cutfish', wasm_powered: '隐私优先 · WASM', upload_media: '导入视频',
      drop_here: '拖入一个或多个视频，或点击选择文件', media_assets: '媒体资源', import: '导入',
      no_assets: '还没有视频，导入文件即可开始。', inspector: '检查器', preview: '预览', trim: '裁剪',
      trim_start: '起点', trim_end: '终点', filters: '滤镜', global: '全局', audio: '音频', audio_sync: '音频同步',
      fade_in: '缓入', fade_out: '缓出', fade_hint: '在导出时应用，实际时长不会超过所选项目区间。',
      brightness: '亮度', contrast: '对比度', saturation: '饱和度', export: '导出',
      exporting: '正在渲染视频…', loading_engine: '正在加载本地引擎…', cancel: '取消', success: '视频已导出。',
      preparing_media: '正在准备并检查媒体…',
      error: '导出失败，请尝试缩短区间或降低质量。', engine_error: '无法加载本地视频引擎。',
      light_mode: '切换到日间主题', dark_mode: '切换到夜间主题', undo: '撤销', redo: '重做',
      delete: '删除', move_left: '前移', move_right: '后移', no_media: '尚未加载媒体',
      auto_saved: '已保存到本机', auto_save: '本地草稿已启用', play: '播放', pause: '暂停',
      back_five: '后退 5 秒', forward_five: '前进 5 秒', video_track: '视频轨', audio_track: '音频轨',
      active_trim: '当前裁剪', no_clip: '未选择片段', export_mp4: '导出 MP4', export_webm: '导出 WebM',
      invalid_file: '请至少选择一个有效的视频文件。', restored: '已恢复本地草稿。', close: '关闭面板',
      language: '切换语言', duration: '{{value}} 秒',
      full_project: '完整项目', export_range: '项目导出区间', range_start: '导出起点', range_end: '导出终点',
      selected_duration: '已选择 {{value}} 秒', resolution: '分辨率', frame_rate: '帧率', quality: '质量 / 大小',
      quality_compact: '紧凑 · 文件最小', quality_balanced: '均衡 · 推荐', quality_high: '高质量 · 文件最大',
      video_bitrate: '目标视频码率', estimated_size: '预计大小',
      size_disclaimer: '实际大小会因画面和编码器而变化；更高的分辨率、帧率和质量需要更长时间。',
      project_duration: '项目 {{value}} 秒', draft_error: '无法保存本地草稿，浏览器存储空间可能已满。',
    },
  },
} as const;

void i18n.use(LanguageDetector).use(initReactI18next).init({
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh'],
  load: 'languageOnly',
  resources,
  interpolation: { escapeValue: false },
  detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
});

export default i18n;
