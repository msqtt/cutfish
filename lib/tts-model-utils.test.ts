import { describe, expect, it, vi } from 'vitest';
import {
  fetchFirstValidModelAsset,
  getModelAssetCandidates,
  getVoiceModelPath,
  validateModelAsset,
} from './tts-model-utils';

describe('TTS model paths', () => {
  it('maps every curated voice to its upstream ONNX path', () => {
    expect(getVoiceModelPath('zh_CN-huayan-x_low')).toBe('zh/zh_CN/huayan/x_low/zh_CN-huayan-x_low.onnx');
    expect(getVoiceModelPath('en_US-hfc_female-medium')).toBe('en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx');
    expect(getVoiceModelPath('en_US-ryan-medium')).toBe('en/en_US/ryan/medium/en_US-ryan-medium.onnx');
  });

  it('prefers the same-origin proxy, then configuration, then official upstream', () => {
    expect(getModelAssetCandidates('zh_CN-huayan-x_low', 'model', 'https://models.example.test/base/')).toEqual([
      '/tts-models/zh/zh_CN/huayan/x_low/zh_CN-huayan-x_low.onnx',
      'https://models.example.test/base/zh/zh_CN/huayan/x_low/zh_CN-huayan-x_low.onnx',
      'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/zh/zh_CN/huayan/x_low/zh_CN-huayan-x_low.onnx',
    ]);
  });
});

describe('TTS model payload validation', () => {
  it('accepts a Piper config and rejects an HTML error page', async () => {
    const config = new Blob([JSON.stringify({
      audio: { sample_rate: 16000 },
      espeak: { voice: 'cmn' },
      inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
    })], { type: 'application/json' });
    await expect(validateModelAsset(config, 'config')).resolves.toBeUndefined();
    await expect(validateModelAsset(new Blob(['<html>bad gateway</html>'], { type: 'text/html' }), 'config')).rejects.toThrow(/config/i);
  });

  it('rejects truncated or textual ONNX payloads', async () => {
    await expect(validateModelAsset(new Blob([new Uint8Array(256)], { type: 'application/octet-stream' }), 'model')).rejects.toThrow(/small/i);
    await expect(validateModelAsset(new Blob(['service unavailable'], { type: 'text/plain' }), 'model')).rejects.toThrow(/model/i);
  });
});

describe('TTS model source fallback', () => {
  it('rejects a failed source and returns the first valid fallback', async () => {
    const validBytes = new Uint8Array(1_000_001);
    validBytes[0] = 8;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('upstream failed', { status: 502 }))
      .mockResolvedValueOnce(new Response(validBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(validBytes.length) },
      }));

    const result = await fetchFirstValidModelAsset(
      ['https://first.invalid/model.onnx', 'https://fallback.test/model.onnx'],
      'model',
      undefined,
      fetcher,
    );

    expect(result.sourceUrl).toBe('https://fallback.test/model.onnx');
    expect(result.blob.size).toBe(validBytes.length);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
