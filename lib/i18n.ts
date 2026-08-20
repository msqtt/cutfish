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
      saturation: 'Saturation', export: 'Export', export_settings: 'Export settings',
      export_settings_hint: 'Choose the project range, format, quality, and expected file size.',
      open_export_settings: 'Open export settings', close_export_settings: 'Close export settings',
      exporting: 'Rendering video…', loading_engine: 'Loading local engine…',
      cancel: 'Cancel', success: 'Your video is ready.', error: 'Export failed. Try a shorter range or a lower quality preset.',
      preparing_media: 'Preparing and inspecting media…',
      engine_error: 'Could not load the local video engine.', light_mode: 'Use light theme', dark_mode: 'Use dark theme',
      undo: 'Undo', redo: 'Redo', delete: 'Delete', duplicate: 'Duplicate', split_clip: 'Split clip',
      split_unavailable: 'Move the playhead inside the trimmed clip before splitting.', reset: 'Reset',
      move_left: 'Move earlier', move_right: 'Move later', project_timeline: 'Project timeline',
      timeline_clip_label: '{{name}}, clip {{index}} of {{total}}, {{duration}} seconds. Click to seek; drag to reorder.',
      no_media: 'No media loaded', auto_saved: 'Saved locally', auto_save: 'Local draft enabled',
      play: 'Play', pause: 'Pause', back_five: 'Back 5 seconds', forward_five: 'Forward 5 seconds',
      video_track: 'Video track', audio_track: 'Audio track', active_trim: 'Active trim', no_clip: 'No clip selected',
      export_mp4: 'Export MP4', export_webm: 'Export WebM', invalid_file: 'Choose at least one valid video file.',
      import_in_progress: 'Another import is already in progress.', duplicate_files: 'These videos are already in the project.',
      importing_file: 'Reading {{name}}', import_complete: 'Imported {{imported}} · skipped {{skipped}} · failed {{failed}}',
      restored: 'Local draft restored.', close: 'Close panel', language: 'Switch language', duration: '{{value}} seconds',
      full_project: 'Full project', export_range: 'Project export range', range_start: 'Export start', range_end: 'Export end',
      selected_duration: '{{value}} seconds selected', resolution: 'Resolution', frame_rate: 'Frame rate', quality: 'Quality / size',
      quality_compact: 'Compact · smallest file', quality_balanced: 'Balanced · recommended', quality_high: 'High · largest file',
      video_bitrate: 'Target video bitrate', estimated_size: 'Estimated size',
      size_disclaimer: 'Estimate varies with the source and codec. Higher resolution, frame rate, and quality take longer.',
      project_duration: 'Project {{value}}s', draft_error: 'The local draft could not be saved. Browser storage may be full.',
      // Inspector tabs
      tab_clip: 'Clip', tab_project: 'Project', tab_audio: 'Audio', tab_effects: 'Effects',
      // Volume / mute / master
      volume: 'Volume', mute: 'Mute', unmute: 'Unmute', master_volume: 'Master volume', clip_volume: 'Clip volume',
      // Timeline zoom / playhead
      zoom_in: 'Zoom in', zoom_out: 'Zoom out', zoom_fit: 'Fit all',
      // Rotation / flip / aspect / fit / speed
      rotation: 'Rotation', flip_h: 'Flip horizontal', flip_v: 'Flip vertical',
      aspect: 'Aspect ratio', fit: 'Fit mode', speed: 'Speed',
      contain: 'Contain', cover: 'Cover', stretch: 'Stretch',
      // Inline rename
      rename: 'Rename', rename_clip: 'Rename clip',
      // Action menu
      actions: 'Actions', more_actions: 'More actions',
      // Multi-project manager
      projects: 'Projects', new_project: 'New project', switch_project: 'Switch project',
      rename_project: 'Rename project', duplicate_project: 'Duplicate project', delete_project: 'Delete project',
      project_name: 'Project name', untitled: 'Untitled', confirm_delete: 'Delete this project permanently?',
      no_projects: 'No projects yet.', project_created: 'Project created.', project_deleted: 'Project deleted.',
      project_switched: 'Switched to project.', project_renamed: 'Project renamed.',
      project_duplicated: 'Project duplicated.',
      // Save status
      saving: 'Saving…', saved: 'Saved', save_error: 'Save failed', last_saved: 'Last saved {{time}}',
      // Help modal
      keyboard_shortcuts: 'Keyboard shortcuts', shortcut_help: 'Press ? for help',
      shortcut_play: 'Play / Pause', shortcut_split: 'Split clip', shortcut_undo: 'Undo',
      shortcut_redo: 'Redo', shortcut_export: 'Quick export', shortcut_delete: 'Delete clip',
      shortcut_back: 'Back 5s', shortcut_forward: 'Forward 5s', shortcut_back_fine: 'Back 1s',
      shortcut_forward_fine: 'Forward 1s', shortcut_fullscreen: 'Toggle fullscreen',
      shortcut_help_key: 'Show shortcuts', shortcut_mute: 'Mute/unmute clip',
      // Fullscreen & compare
      fullscreen: 'Fullscreen', exit_fullscreen: 'Exit fullscreen',
      compare_hold: 'Hold to compare original', comparing: 'Original (no filters)',
      // Mobile bottom-sheet
      bottom_sheet_inspector: 'Inspector', collapse_timeline: 'Collapse timeline',
      expand_timeline: 'Expand timeline',
      // Transitions
      transitions: 'Transitions', transition_type: 'Type', transition_duration: 'Duration',
      add_transition: 'Add transition', remove_transition: 'Remove', no_transition: 'None',
      transition_fade: 'Fade', transition_dissolve: 'Dissolve', transition_wipeleft: 'Wipe left',
      transition_wiperight: 'Wipe right', transition_wipeup: 'Wipe up', transition_wipedown: 'Wipe down',
      transition_slideright: 'Slide right', transition_slideleft: 'Slide left',
      // Text overlay
      text_overlays: 'Text overlays', add_text: 'Add text', edit_text: 'Edit text',
      remove_text: 'Remove text', text_content: 'Content', font_family: 'Font',
      font_size: 'Size', text_color: 'Color', text_position: 'Position',
      text_start: 'Start time', text_end: 'End time', text_x: 'X %', text_y: 'Y %',
      font_sans: 'Sans-serif', font_serif: 'Serif', font_mono: 'Monospace',
      // Background audio
      background_audio: 'Background audio', import_audio: 'Import audio',
      audio_volume: 'Volume', audio_loop: 'Loop', audio_fade_in: 'Fade in',
      audio_fade_out: 'Fade out', remove_audio: 'Remove audio',
      invalid_audio: 'Choose a valid audio file.',
      // Presets
      presets: 'Presets', apply_preset: 'Apply', no_preset: 'Custom',
      preset_social_reel: 'Social Reel', preset_youtube: 'YouTube',
      preset_quick_share: 'Quick Share', preset_cinematic: 'Cinematic',
      // Misc
      confirm: 'Confirm', or: 'or',
      // Custom presets
      custom_presets: 'Custom presets', save_preset: 'Save current as preset',
      preset_name_input: 'Preset name', delete_preset: 'Delete preset',
      preset_saved: 'Preset saved.', preset_deleted: 'Preset deleted.',
      // Output duration
      output_duration: 'Output {{value}}s',
      // Subtitles & Visual Overlays
      tab_subtitles: 'Subtitles & Overlays',
      subtitles: 'Subtitles', add_subtitle: 'Add subtitle', remove_subtitle: 'Remove',
      subtitle_text: 'Text', subtitle_font: 'Font', subtitle_size: 'Size',
      subtitle_color: 'Color', subtitle_bg: 'Background', subtitle_position: 'Position',
      subtitle_width: 'Width %', subtitle_align: 'Align', subtitle_rotation: 'Rotation',
      subtitle_start: 'Start', subtitle_end: 'End', subtitle_x: 'X %', subtitle_y: 'Y %',
      subtitle_line_height: 'Line height', clear_bg: 'Clear',
      align_left: 'Left', align_center: 'Center', align_right: 'Right',
      // TTS
      tts: 'Text-to-Speech', tts_enable: 'Enable TTS', tts_voice: 'Voice',
      tts_lang: 'Language', tts_rate: 'Rate', tts_pitch: 'Pitch', tts_volume: 'Volume',
      tts_preview: 'Preview', tts_stop: 'Stop',
      tts_notice: 'Browser TTS is preview-only and will NOT be included in export.',
      tts_no_voices: 'No voices available in this browser.',
      tts_unsupported: 'Your browser does not support Web Speech API. TTS is disabled. / 您的浏览器不支持 Web Speech API，TTS 已禁用。',
      // Visual overlays
      visual_overlays: 'Visual overlays', add_drawing: 'Draw', add_rectangle: 'Rectangle',
      add_image: 'Image', remove_overlay: 'Remove', overlay_position: 'Position',
      overlay_size: 'Size', overlay_rotation: 'Rotation', overlay_opacity: 'Opacity',
      overlay_start: 'Start', overlay_end: 'End', overlay_stroke: 'Stroke',
      overlay_fill: 'Fill', clear_fill: 'Clear fill', overlay_line_width: 'Line width',
      overlay_width: 'W %', overlay_height: 'H %', overlay_x: 'X %', overlay_y: 'Y %',
      overlay_drawing_hint: 'Draw on the preview area with the pen tool active.',
      overlay_rect_hint: 'Drag on the preview area to draw a rectangle.',
      overlay_select: 'Select', overlay_pen: 'Pen', overlay_rect_tool: 'Rect',
      no_overlays: 'No overlays yet.',
      selected_overlay: 'Selected',
      // Drawing tool
      drawing_mode: 'Drawing mode active. Draw on the preview.',
      rect_mode: 'Rectangle mode active. Drag on the preview.',
    },
  },
  zh: {
    translation: {
      app_title: 'Cutfish', wasm_powered: '隐私优先 · WASM', upload_media: '导入视频',
      drop_here: '拖入一个或多个视频，或点击选择文件', media_assets: '媒体资源', import: '导入',
      no_assets: '还没有视频，导入文件即可开始。', inspector: '检查器', preview: '预览', trim: '裁剪',
      trim_start: '起点', trim_end: '终点', filters: '滤镜', global: '全局', audio: '音频', audio_sync: '音频同步',
      fade_in: '缓入', fade_out: '缓出', fade_hint: '在导出时应用，实际时长不会超过所选项目区间。',
      brightness: '亮度', contrast: '对比度', saturation: '饱和度', export: '导出', export_settings: '导出设置',
      export_settings_hint: '配置项目区间、格式、质量和预计文件大小。',
      open_export_settings: '打开导出设置', close_export_settings: '关闭导出设置',
      exporting: '正在渲染视频…', loading_engine: '正在加载本地引擎…', cancel: '取消', success: '视频已导出。',
      preparing_media: '正在准备并检查媒体…',
      error: '导出失败，请尝试缩短区间或降低质量。', engine_error: '无法加载本地视频引擎。',
      light_mode: '切换到日间主题', dark_mode: '切换到夜间主题', undo: '撤销', redo: '重做',
      delete: '删除', duplicate: '复制片段', split_clip: '分割片段',
      split_unavailable: '请先将播放头移到裁剪片段内部再进行分割。', reset: '重置',
      move_left: '前移', move_right: '后移', project_timeline: '项目时间轴',
      timeline_clip_label: '{{name}}，第 {{index}}/{{total}} 个片段，{{duration}} 秒。点击定位，拖动排序。', no_media: '尚未加载媒体',
      auto_saved: '已保存到本机', auto_save: '本地草稿已启用', play: '播放', pause: '暂停',
      back_five: '后退 5 秒', forward_five: '前进 5 秒', video_track: '视频轨', audio_track: '音频轨',
      active_trim: '当前裁剪', no_clip: '未选择片段', export_mp4: '导出 MP4', export_webm: '导出 WebM',
      invalid_file: '请至少选择一个有效的视频文件。', import_in_progress: '已有导入任务正在进行。',
      duplicate_files: '这些视频已经在项目中。', importing_file: '正在读取 {{name}}',
      import_complete: '已导入 {{imported}} · 跳过 {{skipped}} · 失败 {{failed}}',
      restored: '已恢复本地草稿。', close: '关闭面板',
      language: '切换语言', duration: '{{value}} 秒',
      full_project: '完整项目', export_range: '项目导出区间', range_start: '导出起点', range_end: '导出终点',
      selected_duration: '已选择 {{value}} 秒', resolution: '分辨率', frame_rate: '帧率', quality: '质量 / 大小',
      quality_compact: '紧凑 · 文件最小', quality_balanced: '均衡 · 推荐', quality_high: '高质量 · 文件最大',
      video_bitrate: '目标视频码率', estimated_size: '预计大小',
      size_disclaimer: '实际大小会因画面和编码器而变化；更高的分辨率、帧率和质量需要更长时间。',
      project_duration: '项目 {{value}} 秒', draft_error: '无法保存本地草稿，浏览器存储空间可能已满。',
      // Inspector tabs
      tab_clip: '片段', tab_project: '项目', tab_audio: '音频', tab_effects: '效果',
      // Volume / mute / master
      volume: '音量', mute: '静音', unmute: '取消静音', master_volume: '主音量', clip_volume: '片段音量',
      // Timeline zoom / playhead
      zoom_in: '放大', zoom_out: '缩小', zoom_fit: '适应全部',
      // Rotation / flip / aspect / fit / speed
      rotation: '旋转', flip_h: '水平翻转', flip_v: '垂直翻转',
      aspect: '画面比例', fit: '填充模式', speed: '速度',
      contain: '适应', cover: '覆盖', stretch: '拉伸',
      // Inline rename
      rename: '重命名', rename_clip: '重命名片段',
      // Action menu
      actions: '操作', more_actions: '更多操作',
      // Multi-project manager
      projects: '项目', new_project: '新建项目', switch_project: '切换项目',
      rename_project: '重命名项目', duplicate_project: '复制项目', delete_project: '删除项目',
      project_name: '项目名称', untitled: '未命名', confirm_delete: '确定永久删除此项目？',
      no_projects: '还没有项目。', project_created: '项目已创建。', project_deleted: '项目已删除。',
      project_switched: '已切换项目。', project_renamed: '项目已重命名。',
      project_duplicated: '项目已复制。',
      // Save status
      saving: '保存中…', saved: '已保存', save_error: '保存失败', last_saved: '上次保存 {{time}}',
      // Help modal
      keyboard_shortcuts: '快捷键', shortcut_help: '按 ? 查看帮助',
      shortcut_play: '播放 / 暂停', shortcut_split: '分割片段', shortcut_undo: '撤销',
      shortcut_redo: '重做', shortcut_export: '快速导出', shortcut_delete: '删除片段',
      shortcut_back: '后退 5 秒', shortcut_forward: '前进 5 秒', shortcut_back_fine: '后退 1 秒',
      shortcut_forward_fine: '前进 1 秒', shortcut_fullscreen: '切换全屏',
      shortcut_help_key: '显示快捷键', shortcut_mute: '静音/取消静音',
      // Fullscreen & compare
      fullscreen: '全屏', exit_fullscreen: '退出全屏',
      compare_hold: '按住比较原始画面', comparing: '原始画面（无滤镜）',
      // Mobile bottom-sheet
      bottom_sheet_inspector: '检查器', collapse_timeline: '折叠时间轴',
      expand_timeline: '展开时间轴',
      // Transitions
      transitions: '转场', transition_type: '类型', transition_duration: '时长',
      add_transition: '添加转场', remove_transition: '移除', no_transition: '无',
      transition_fade: '淡入淡出', transition_dissolve: '溶解', transition_wipeleft: '左擦除',
      transition_wiperight: '右擦除', transition_wipeup: '上擦除', transition_wipedown: '下擦除',
      transition_slideright: '右滑', transition_slideleft: '左滑',
      // Text overlay
      text_overlays: '文字叠加', add_text: '添加文字', edit_text: '编辑文字',
      remove_text: '移除文字', text_content: '内容', font_family: '字体',
      font_size: '大小', text_color: '颜色', text_position: '位置',
      text_start: '开始时间', text_end: '结束时间', text_x: 'X %', text_y: 'Y %',
      font_sans: '无衬线', font_serif: '衬线', font_mono: '等宽',
      // Background audio
      background_audio: '背景音乐', import_audio: '导入音频',
      audio_volume: '音量', audio_loop: '循环', audio_fade_in: '淡入',
      audio_fade_out: '淡出', remove_audio: '移除音频',
      invalid_audio: '请选择有效的音频文件。',
      // Presets
      presets: '预设', apply_preset: '应用', no_preset: '自定义',
      preset_social_reel: '社交短视频', preset_youtube: 'YouTube',
      preset_quick_share: '快速分享', preset_cinematic: '电影感',
      // Misc
      confirm: '确认', or: '或',
      // Custom presets
      custom_presets: '自定义预设', save_preset: '保存为预设',
      preset_name_input: '预设名称', delete_preset: '删除预设',
      preset_saved: '预设已保存。', preset_deleted: '预设已删除。',
      // Output duration
      output_duration: '输出 {{value}} 秒',
      // Subtitles & Visual Overlays
      tab_subtitles: '字幕与标注',
      subtitles: '字幕', add_subtitle: '添加字幕', remove_subtitle: '移除',
      subtitle_text: '文本', subtitle_font: '字体', subtitle_size: '大小',
      subtitle_color: '颜色', subtitle_bg: '背景色', subtitle_position: '位置',
      subtitle_width: '宽度 %', subtitle_align: '对齐', subtitle_rotation: '旋转',
      subtitle_start: '开始', subtitle_end: '结束', subtitle_x: 'X %', subtitle_y: 'Y %',
      subtitle_line_height: '行高', clear_bg: '清除',
      align_left: '左对齐', align_center: '居中', align_right: '右对齐',
      // TTS
      tts: '语音合成', tts_enable: '启用 TTS', tts_voice: '语音',
      tts_lang: '语言', tts_rate: '语速', tts_pitch: '音调', tts_volume: '音量',
      tts_preview: '试听', tts_stop: '停止',
      tts_notice: '浏览器 TTS 仅用于预览，不会包含在导出音轨中。',
      tts_unsupported: '您的浏览器不支持 Web Speech API，TTS 已禁用。/ Your browser does not support Web Speech API.',
      tts_no_voices: '当前浏览器无可用语音。',
      // Visual overlays
      visual_overlays: '视觉标注', add_drawing: '画笔', add_rectangle: '矩形',
      add_image: '图片', remove_overlay: '移除', overlay_position: '位置',
      overlay_size: '尺寸', overlay_rotation: '旋转', overlay_opacity: '透明度',
      overlay_start: '开始', overlay_end: '结束', overlay_stroke: '描边',
      overlay_fill: '填充', clear_fill: '清除填充', overlay_line_width: '线宽',
      overlay_width: '宽 %', overlay_height: '高 %', overlay_x: 'X %', overlay_y: 'Y %',
      overlay_drawing_hint: '使用画笔工具在预览区域绘制。',
      overlay_rect_hint: '在预览区域拖动绘制矩形。',
      overlay_select: '选择', overlay_pen: '画笔', overlay_rect_tool: '矩形',
      no_overlays: '暂无标注。',
      selected_overlay: '已选中',
      // Drawing tool
      drawing_mode: '画笔模式已激活。在预览区域绘制。',
      rect_mode: '矩形模式已激活。在预览区域拖动。',
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
