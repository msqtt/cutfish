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
      global: 'Global', audio_sync: 'Audio sync', brightness: 'Brightness', contrast: 'Contrast',
      saturation: 'Saturation', export: 'Export', exporting: 'Rendering video…', loading_engine: 'Loading local engine…',
      cancel: 'Cancel', success: 'Your video is ready.', error: 'Export failed. Check that every video contains an audio track.',
      engine_error: 'Could not load the local video engine.', light_mode: 'Use light theme', dark_mode: 'Use dark theme',
      undo: 'Undo', redo: 'Redo', delete: 'Delete', move_left: 'Move earlier', move_right: 'Move later',
      no_media: 'No media loaded', auto_saved: 'Saved locally', auto_save: 'Local draft enabled',
      play: 'Play', pause: 'Pause', back_five: 'Back 5 seconds', forward_five: 'Forward 5 seconds',
      video_track: 'Video track', audio_track: 'Audio track', active_trim: 'Active trim', no_clip: 'No clip selected',
      export_mp4: 'Export MP4', export_webm: 'Export WebM', invalid_file: 'Choose at least one valid video file.',
      restored: 'Local draft restored.', close: 'Close panel', language: 'Switch language', duration: '{{value}} seconds',
    },
  },
  zh: {
    translation: {
      app_title: 'Cutfish', wasm_powered: '隐私优先 · WASM', upload_media: '导入视频',
      drop_here: '拖入一个或多个视频，或点击选择文件', media_assets: '媒体资源', import: '导入',
      no_assets: '还没有视频，导入文件即可开始。', inspector: '检查器', preview: '预览', trim: '裁剪',
      trim_start: '起点', trim_end: '终点', filters: '滤镜', global: '全局', audio_sync: '音频同步',
      brightness: '亮度', contrast: '对比度', saturation: '饱和度', export: '导出',
      exporting: '正在渲染视频…', loading_engine: '正在加载本地引擎…', cancel: '取消', success: '视频已导出。',
      error: '导出失败，请确认每个视频都包含音轨。', engine_error: '无法加载本地视频引擎。',
      light_mode: '切换到日间主题', dark_mode: '切换到夜间主题', undo: '撤销', redo: '重做',
      delete: '删除', move_left: '前移', move_right: '后移', no_media: '尚未加载媒体',
      auto_saved: '已保存到本机', auto_save: '本地草稿已启用', play: '播放', pause: '暂停',
      back_five: '后退 5 秒', forward_five: '前进 5 秒', video_track: '视频轨', audio_track: '音频轨',
      active_trim: '当前裁剪', no_clip: '未选择片段', export_mp4: '导出 MP4', export_webm: '导出 WebM',
      invalid_file: '请至少选择一个有效的视频文件。', restored: '已恢复本地草稿。', close: '关闭面板',
      language: '切换语言', duration: '{{value}} 秒',
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
