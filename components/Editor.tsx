"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { set, get } from 'idb-keyval';
import '@/lib/i18n';
import { 
  Upload, Scissors, Sliders, Volume2, Download, 
  Sun, Moon, Monitor, Type, Play, Pause, FileVideo, 
  RotateCcw, RotateCw, MonitorPlay, Undo2, Redo2, Plus
} from 'lucide-react';

import { useHistory } from '@/lib/history';
import { buildFFmpegCommand } from '@/lib/ffmpeg-utils';

// --- Types ---
export interface Clip {
  id: string;
  url: string;
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  file?: File; // Optional when loaded from IndexedDB draft (requires re-uploading theoretically, but blob urls might survive session)
}

export interface EditorState {
  clips: Clip[];
  activeClipId: string | null;
  audioDelay: number;
  filters: {
    brightness: number;
    contrast: number;
    saturation: number;
  };
}

const DEFAULT_STATE: EditorState = {
  clips: [],
  activeClipId: null,
  audioDelay: 0,
  filters: { brightness: 100, contrast: 100, saturation: 100 },
};

export default function Editor() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme, systemTheme } = useTheme();

  const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const { state, set: updateState, undo, redo, canUndo, canRedo, reset } = useHistory<EditorState>(DEFAULT_STATE);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeClip = state.clips.find(c => c.id === state.activeClipId);

  // Load FFmpeg
  useEffect(() => {
    const load = async () => {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.max(0, Math.min(100, progress * 100)));
      });
      
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setFfmpeg(ffmpeg);
        setLoaded(true);
      } catch (err) {
        console.error("FFmpeg load failed", err);
      }
    };
    load();
  }, []);

  // Load Draft from IndexedDB
  useEffect(() => {
    const loadDraft = async () => {
      const draft = await get('video-editor-draft');
      if (draft && draft.clips && draft.clips.length > 0) {
        // verify first blob is still accessible
        try {
          const res = await fetch(draft.clips[0].url);
          if (res.ok) {
            reset(draft);
          }
        } catch {
          console.warn("Draft blob expired");
        }
      }
    };
    loadDraft();
  }, [reset]);

  // Auto-save draft
  useEffect(() => {
    if (state.clips.length > 0) {
      set('video-editor-draft', state).catch(console.error);
    }
  }, [state]);

  const togglePlay = useCallback(() => {
    if (videoRef.current && activeClip) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, activeClip]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, undo, redo]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const newClip: Clip = {
        id: Math.random().toString(36).substring(7),
        url,
        name: file.name,
        duration: 0, // will be set on metadata load
        trimStart: 0,
        trimEnd: 0,
        file
      };
      
      updateState(s => ({
        ...s,
        clips: [...s.clips, newClip],
        activeClipId: newClip.id // Auto select new clip
      }));
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current && activeClip) {
      const dur = videoRef.current.duration;
      // Only set duration if not already set (prevents history spam on re-renders)
      if (activeClip.duration === 0) {
        updateState(s => ({
          ...s,
          clips: s.clips.map(c => c.id === activeClip.id ? { ...c, duration: dur, trimEnd: dur } : c)
        }));
      }
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current && activeClip) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      if (time >= activeClip.trimEnd && isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
        videoRef.current.currentTime = activeClip.trimStart;
      }
    }
  };

  const updateFilter = (key: keyof EditorState['filters'], value: number) => {
    updateState(s => ({
      ...s,
      filters: { ...s.filters, [key]: value }
    }));
  };

  const updateActiveClip = (updates: Partial<Clip>) => {
    if (!activeClip) return;
    updateState(s => ({
      ...s,
      clips: s.clips.map(c => c.id === activeClip.id ? { ...c, ...updates } : c)
    }));
  };

  const handleExport = async (format: 'mp4' | 'webm') => {
    if (!ffmpeg || !loaded || state.clips.length === 0) return;
    setProcessing(true);
    setProgress(0);
    try {
      // Write files to FFmpeg memory
      const metadataForFfmpeg = await Promise.all(state.clips.map(async (clip, idx) => {
        const ext = clip.name.split('.').pop() || 'mp4';
        const filename = `input_${idx}.${ext}`;
        
        // Use the original File object if available, otherwise fetch from blob URL
        if (clip.file) {
          await ffmpeg.writeFile(filename, await fetchFile(clip.file));
        } else {
          await ffmpeg.writeFile(filename, await fetchFile(clip.url));
        }
        
        return {
          id: clip.id,
          filename,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd
        };
      }));

      const args = buildFFmpegCommand(metadataForFfmpeg, state.filters, state.audioDelay, format);
      
      await ffmpeg.exec(args);
      
      const data = await ffmpeg.readFile(`output.${format}`);
      const url = URL.createObjectURL(new Blob([data as any], { type: `video/${format}` }));
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `exported_video.${format}`;
      a.click();
      
    } catch (err) {
      console.error(err);
      alert(t('error'));
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  // Preview CSS Filters
  const previewStyle = {
    filter: `brightness(${state.filters.brightness}%) contrast(${state.filters.contrast}%) saturate(${state.filters.saturation}%)`
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0a0a] text-[#e5e7eb] font-sans">
      {/* HEADER */}
      <header className="h-12 border-b border-[#222] flex items-center justify-between px-4 shrink-0 bg-[#111]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <MonitorPlay className="w-5 h-5 text-indigo-500" />
            <h1 className="text-sm font-semibold tracking-tight">{t('app_title')} <span className="text-[10px] text-indigo-400 font-mono ml-2 border border-indigo-900 px-1 rounded">WASM POWERED</span></h1>
          </div>
          <div className="flex items-center gap-2 border-l border-[#333] pl-4 ml-2">
            <button onClick={undo} disabled={!canUndo} className="p-1.5 hover:bg-[#222] rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors" title={t('undo') + " (Ctrl+Z)"}>
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={redo} disabled={!canRedo} className="p-1.5 hover:bg-[#222] rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors" title={t('redo') + " (Ctrl+Y)"}>
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span>Auto-save enabled</span>
          </div>
          <div className="flex gap-3 items-center">
            <button 
              onClick={() => i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh')}
              className="text-[11px] hover:text-white border border-[#333] px-3 py-1 rounded transition-colors"
            >
              {i18n.language.startsWith('zh') ? 'EN' : '中文'}
            </button>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="text-[11px] hover:text-white border border-[#333] px-2 py-1 rounded transition-colors flex items-center justify-center">
              {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT SIDEBAR - MEDIA ASSETS */}
        <aside className="w-64 border-r border-[#222] bg-[#0d0d0d] flex flex-col shrink-0">
          <div className="p-3 border-b border-[#222] flex justify-between items-center">
            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Media Assets</span>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="text-indigo-400 text-xs hover:text-indigo-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Import
            </button>
          </div>
          <div className="flex-1 p-2 space-y-2 overflow-y-auto">
            {state.clips.map((clip, idx) => (
              <div 
                key={clip.id} 
                onClick={() => updateState(s => ({ ...s, activeClipId: clip.id }))}
                className={`p-2 rounded border cursor-pointer transition-colors ${
                  state.activeClipId === clip.id 
                  ? 'bg-[#1a1a1a] border-indigo-900/50 ring-1 ring-indigo-500/20' 
                  : 'bg-[#1a1a1a] border-[#333] hover:border-gray-500 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="aspect-video bg-[#222] rounded mb-1 flex items-center justify-center text-[10px] text-gray-600 relative overflow-hidden">
                  <video src={clip.url} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                  <span className="relative z-10 bg-black/60 px-1 rounded">{clip.duration.toFixed(1)}s</span>
                </div>
                <p className={`text-[10px] truncate ${state.activeClipId === clip.id ? 'text-indigo-300' : 'text-gray-400'}`}>
                  {clip.name}
                </p>
              </div>
            ))}
            
            {state.clips.length === 0 && (
              <div className="text-center p-4 text-[10px] text-gray-500 border border-dashed border-[#333] rounded mt-2">
                No assets imported.<br/>Click + Import to start.
              </div>
            )}
          </div>
        </aside>

        {/* PREVIEW AREA */}
        <section className="flex-1 flex flex-col bg-[#000] relative">
          <div className="flex-1 flex items-center justify-center p-8">
            {!activeClip ? (
              <div className="relative w-full max-w-2xl aspect-video bg-[#050505] shadow-2xl rounded-lg overflow-hidden border border-[#222] flex items-center justify-center flex-col gap-4 group hover:border-indigo-500 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle,rgba(79,70,229,0.2)_0%,transparent_70%)] pointer-events-none"></div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="video/*" 
                  onChange={handleFileUpload} 
                />
                <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center group-hover:border-indigo-500 transition-colors z-10 relative">
                  <Upload className="w-5 h-5 text-gray-400 group-hover:text-indigo-400" />
                </div>
                <div className="text-center z-10 relative">
                  <p className="font-medium text-sm text-gray-300">{t('upload_media')}</p>
                  <p className="text-[10px] text-gray-500 mt-1">{t('drop_here')}</p>
                </div>
              </div>
            ) : (
              <div className="relative w-full max-w-2xl aspect-video bg-[#050505] shadow-2xl rounded-lg overflow-hidden border border-[#222] flex items-center justify-center">
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle,rgba(79,70,229,0.2)_0%,transparent_70%)] pointer-events-none"></div>
                <video 
                  ref={videoRef}
                  src={activeClip.url}
                  className="max-h-full max-w-full object-contain relative z-10"
                  style={previewStyle}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onClick={togglePlay}
                />
                
                {/* Time Overlay */}
                <div className="absolute top-4 left-4 px-2 py-1 bg-black/60 rounded text-[10px] font-mono z-20 text-gray-300">
                  {currentTime.toFixed(2)}s / {activeClip.duration.toFixed(2)}s
                </div>
              </div>
            )}
          </div>

          {/* PLAYBACK CONTROLS BAR */}
          <div className="h-12 bg-[#111] border-t border-[#222] flex items-center justify-center gap-6 shrink-0">
            <button className="p-2 hover:bg-[#222] rounded text-gray-400 hover:text-white transition-colors">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={togglePlay} disabled={!activeClip} className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center text-lg disabled:opacity-50 hover:scale-105 transition-transform">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
            </button>
            <button className="p-2 hover:bg-[#222] rounded text-gray-400 hover:text-white transition-colors">
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          {/* Processing Overlay */}
          {processing && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="font-medium text-lg mb-2 text-white">{t('exporting')}</p>
              <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="text-sm text-gray-500 mt-2 font-mono">{progress.toFixed(0)}%</p>
            </div>
          )}
        </section>

        {/* RIGHT SIDEBAR - CONTROLS */}
        <aside className="w-72 border-l border-[#222] bg-[#0d0d0d] flex flex-col shrink-0 overflow-y-auto">
          <div className="p-3 border-b border-[#222] text-[10px] uppercase tracking-widest font-bold text-gray-500">
            Inspector
          </div>
          
          <div className="p-4 space-y-6 flex-1">
            <div>
              <label className="text-[11px] text-gray-400 block mb-2">{t('filters')} (Global)</label>
              <div className="space-y-4">
                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>{t('brightness')}</span>
                    <span>{state.filters.brightness}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="200" 
                    value={state.filters.brightness}
                    onChange={(e) => updateFilter('brightness', Number(e.target.value))}
                    className="w-full accent-indigo-500 bg-[#333] h-1 rounded-lg cursor-pointer appearance-none"
                  />
                </label>
                
                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>{t('contrast')}</span>
                    <span>{state.filters.contrast}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="200" 
                    value={state.filters.contrast}
                    onChange={(e) => updateFilter('contrast', Number(e.target.value))}
                    className="w-full accent-indigo-500 bg-[#333] h-1 rounded-lg cursor-pointer appearance-none"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>{t('saturation')}</span>
                    <span>{state.filters.saturation}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="200" 
                    value={state.filters.saturation}
                    onChange={(e) => updateFilter('saturation', Number(e.target.value))}
                    className="w-full accent-indigo-500 bg-[#333] h-1 rounded-lg cursor-pointer appearance-none"
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-gray-400 block mb-2">{t('audio_sync')} (Global)</label>
              <input 
                type="range" min="-5000" max="5000" step="100"
                value={state.audioDelay}
                onChange={(e) => updateState(s => ({ ...s, audioDelay: Number(e.target.value) }))}
                className="w-full accent-indigo-500 bg-[#333] h-1 rounded-lg cursor-pointer appearance-none"
              />
              <div className="flex justify-between text-[9px] mt-1 text-gray-500">
                <span>-5000ms</span>
                <span>{state.audioDelay}ms</span>
                <span>+5000ms</span>
              </div>
            </div>
            
            <div>
              <label className="text-[11px] text-gray-400 block mb-2">WASM Encoder Output</label>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleExport('mp4')}
                  disabled={state.clips.length === 0 || !loaded || processing}
                  className="flex-1 p-2 bg-[#1a1a1a] border border-[#333] hover:border-indigo-500 text-[10px] rounded transition-colors disabled:opacity-50 disabled:hover:border-[#333]"
                >
                  Export MP4
                </button>
                <button 
                  onClick={() => handleExport('webm')}
                  disabled={state.clips.length === 0 || !loaded || processing}
                  className="flex-1 p-2 bg-[#1a1a1a] border border-[#333] hover:border-indigo-500 text-[10px] rounded transition-colors disabled:opacity-50 disabled:hover:border-[#333]"
                >
                  Export WebM
                </button>
              </div>
              {!loaded && (
                <p className="text-[9px] text-indigo-400 text-center animate-pulse mt-2">{t('loading_ffmpeg')}</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* BOTTOM TIMELINE */}
      <footer className="h-56 border-t border-[#222] bg-[#0d0d0d] flex flex-col shrink-0">
        <div className="h-8 border-b border-[#222] flex items-center px-4 gap-4 text-[10px] text-gray-500 shrink-0">
          <div className="flex items-center gap-1"><span className="text-white">V1</span> <span>Video Track</span></div>
          <div className="flex items-center gap-1"><span className="text-white">A1</span> <span>Audio Track</span></div>
          <div className="flex-1"></div>
          <div className="flex gap-4">
            <span className="font-mono text-indigo-400">
              {activeClip ? `Active Trim: ${activeClip.trimStart.toFixed(1)}s - ${activeClip.trimEnd.toFixed(1)}s` : 'No clip selected'}
            </span>
          </div>
        </div>
        
        {state.clips.length > 0 ? (
          <div className="flex-1 overflow-x-auto flex relative p-2">
            <div className="min-w-full flex gap-2 h-full pt-4 relative pb-6">
              {/* Timeline Tracks */}
              {state.clips.map((clip, index) => (
                <div key={clip.id} className="relative h-12 shrink-0 bg-[#1a1a1a] rounded border border-[#333] overflow-hidden top-6" style={{ width: `${Math.max(clip.duration * 10, 150)}px` }}>
                  <div 
                    className={`absolute top-0 bottom-0 border-l border-r flex items-center px-2 text-[9px] font-mono transition-colors ${state.activeClipId === clip.id ? 'bg-indigo-900/40 border-indigo-400 text-indigo-200 z-10' : 'bg-[#222] border-[#444] text-gray-500 cursor-pointer'}`}
                    style={{ 
                      left: `${(clip.trimStart / Math.max(clip.duration, 0.1)) * 100}%`,
                      right: `${100 - (clip.trimEnd / Math.max(clip.duration, 0.1)) * 100}%` 
                    }}
                    onClick={() => updateState(s => ({ ...s, activeClipId: clip.id }))}
                  >
                    <span className="truncate">{clip.name}</span>
                  </div>
                  
                  {/* Show trim handles only for active clip */}
                  {state.activeClipId === clip.id && (
                    <>
                      <input 
                        type="range" min="0" max={clip.duration} step="0.1"
                        value={clip.trimStart}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val < clip.trimEnd) updateActiveClip({ trimStart: val });
                        }}
                        className="absolute inset-0 h-full w-full z-20 opacity-0 cursor-ew-resize pointer-events-auto"
                      />
                      <input 
                        type="range" min="0" max={clip.duration} step="0.1"
                        value={clip.trimEnd}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val > clip.trimStart) updateActiveClip({ trimEnd: val });
                        }}
                        className="absolute inset-0 h-full w-full z-20 opacity-0 cursor-ew-resize pointer-events-auto"
                      />
                    </>
                  )}
                </div>
              ))}
              
              {/* Global Time ticks (Simplified) */}
              <div className="absolute bottom-0 left-0 right-0 border-t border-[#222] pt-1 pointer-events-none" />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
            {t('no_media')}
          </div>
        )}
      </footer>
    </div>
  );
}
