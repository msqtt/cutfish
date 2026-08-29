import { isCuratedModelAssetPath } from '@/lib/tts-model-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REVISION = '840e38a7e26d813bd6221b78cfbaefa3585b3f71';
const UPSTREAM_BASES = [
  `https://hf-mirror.com/api/resolve-cache/models/diffusionstudio/piper-voices/${REVISION}`,
  `https://huggingface.co/api/resolve-cache/models/diffusionstudio/piper-voices/${REVISION}`,
] as const;

function upstreamUrl(base: string, path: string): string {
  return `${base}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: segments } = await context.params;
  const path = segments.join('/');
  if (!isCuratedModelAssetPath(path)) {
    return Response.json({ error: 'Unknown TTS model asset' }, { status: 404 });
  }

  const isConfig = path.endsWith('.json');
  const failures: string[] = [];
  for (const base of UPSTREAM_BASES) {
    const url = upstreamUrl(base, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: isConfig ? 'follow' : 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (isConfig && response.ok) {
        const body = await response.arrayBuffer();
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
            'Content-Length': String(body.byteLength),
            'Cache-Control': 'public, max-age=86400, immutable',
          },
        });
      }

      if (!isConfig && response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (location) {
          return new Response(null, {
            status: 307,
            headers: {
              Location: new URL(location, url).toString(),
              'Cache-Control': 'no-store',
            },
          });
        }
      }

      if (!isConfig && response.ok && response.body) {
        return new Response(response.body, {
          status: 200,
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
            ...(response.headers.get('Content-Length') ? { 'Content-Length': response.headers.get('Content-Length')! } : {}),
            'Cache-Control': 'public, max-age=86400, immutable',
          },
        });
      }

      failures.push(`${url}: HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error('TTS model proxy sources failed', failures);
  return Response.json({ error: 'TTS model source unavailable' }, { status: 502 });
}
