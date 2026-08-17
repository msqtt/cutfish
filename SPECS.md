# Software Design Document & Specifications (SPECS)

## 1. Missing Features Identified
Based on the initial requirements, the following features are pending implementation:
1. **Video Merging (多视频合并)**: Capability to upload multiple video clips, arrange them, and export them as a single concatenated video.
2. **Undo/Redo History (撤销/重做)**: State management to track changes (trimming, filters, sync) and allow users to revert or reapply them.
3. **Media Assets UI (媒体资源库)**: A left sidebar to manage imported clips, as defined in the "Elegant Dark" design.

## 2. Technical Specifications

### 2.1 State Management (History)
- **Architecture**: Implement a custom React hook `useHistory<T>` to manage `past`, `present`, and `future` states.
- **Data Flow**: Every time a user finishes an action (e.g., changes a filter, trims a video, adds a clip), the new state is pushed to `past`.
- **Isolation (TDD)**: The history logic will be strictly isolated in `lib/history.ts` and export predictable state mutation functions.

### 2.2 Video Merging Engine
- **Architecture**: FFmpeg `filter_complex` will be used to concatenate multiple inputs robustly, normalizing resolution and framerate to prevent codec mismatch errors.
- **Data Flow**: 
  - Input: Array of `Clip` objects (each with `trimStart`, `trimEnd`, `file`).
  - Transformation: A pure function `buildFFmpegCommand(clips, filters, audioDelay)` will generate the complex filter string.
  - Output: Executable FFmpeg arguments array.
- **Isolation (TDD)**: Command generation will be isolated in `lib/ffmpeg-utils.ts` to ensure it can be tested independently of the UI.

### 2.3 State Shape Update
```typescript
interface Clip {
  id: string;
  url: string;
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  file: File;
}

interface EditorState {
  clips: Clip[];
  activeClipId: string | null;
  audioDelay: number;
  filters: {
    brightness: number;
    contrast: number;
    saturation: number;
  };
}
```

## 3. Development Plan (TDD Approach)
1. Write `SPECS.md` (Current Step).
2. Implement isolated pure logic for Undo/Redo (`lib/history.ts`).
3. Implement isolated pure logic for FFmpeg command generation (`lib/ffmpeg-utils.ts`).
4. Integrate the new state and multiple clip UI into `components/Editor.tsx`.
5. Verify functionality matches these specs.
