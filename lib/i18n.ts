import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          app_title: "WebWasm Editor",
          upload_media: "Upload Media",
          drop_here: "Drop video files here or click to select",
          export: "Export",
          trim: "Trim",
          filters: "Filters",
          audio_sync: "Audio Sync",
          brightness: "Brightness",
          contrast: "Contrast",
          saturation: "Saturation",
          format: "Format",
          exporting: "Exporting...",
          success: "Export Successful",
          error: "An error occurred",
          light_mode: "Light Mode",
          dark_mode: "Dark Mode",
          undo: "Undo",
          redo: "Redo",
          no_media: "No media loaded",
          auto_saved: "Draft auto-saved",
          loading_ffmpeg: "Loading engine...",
        }
      },
      zh: {
        translation: {
          app_title: "WebWasm 剪辑",
          upload_media: "上传媒体",
          drop_here: "将视频文件拖放到此处或点击选择",
          export: "导出",
          trim: "裁剪",
          filters: "滤镜",
          audio_sync: "音频同步",
          brightness: "亮度",
          contrast: "对比度",
          saturation: "饱和度",
          format: "格式",
          exporting: "正在导出...",
          success: "导出成功",
          error: "发生错误",
          light_mode: "日间模式",
          dark_mode: "夜间模式",
          undo: "撤销",
          redo: "重做",
          no_media: "未加载媒体",
          auto_saved: "草稿已自动保存",
          loading_ffmpeg: "正在加载引擎...",
        }
      }
    },
    interpolation: {
      escapeValue: false,
    }
  });

export default i18n;
