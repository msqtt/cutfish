import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const modelPath = ['zh', 'zh_CN', 'huayan', 'x_low', 'zh_CN-huayan-x_low.onnx'];

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TTS model route signed redirect freshness', () => {
  it('cache-busts ONNX metadata resolution and returns only an allowlisted CDN redirect', async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://us.aws.cdn.hf.co/model?Expires=fresh' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/tts-models/model'), context(modelPath));

    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe('https://us.aws.cdn.hf.co/model?Expires=fresh');
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain('?download=true&ts=');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'manual' });
  });

  it('keeps JSON config requests free of cache-busting query parameters', async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response('{"audio":{}}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/tts-models/config'), context([...modelPath.slice(0, -1), `${modelPath.at(-1)}.json`]));

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('?download=true');
    expect(await response.text()).toBe('{"audio":{}}');
  });
});
