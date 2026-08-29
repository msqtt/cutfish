# Reliable local TTS model download SDD

## Problem

`@diffusionstudio/vits-web@1.0.3` hard-codes Hugging Face model URLs. Its streaming helper does not check `Response.ok` or validate payloads before writing them to OPFS, and `stored()` treats any `.onnx` filename as a valid cached voice. A timeout, blocked Hugging Face connection, or HTML error response can therefore poison the cache and make every later synthesis fail.

## Architecture

- `lib/tts-model-utils.ts` owns the curated voice-to-repository path map, candidate URL construction, streamed fetch retries, and payload validation.
- `lib/local-tts.ts` owns browser OPFS access. Before inference it validates both `<voice>.onnx` and `<voice>.onnx.json`; missing or corrupt pairs are replaced, with the model written last so partial downloads are never reported as complete.
- `/tts-models/*` is a same-origin, allowlisted model route. It relays the small Piper JSON config, but for ONNX assets it requests only the upstream signed CDN location and redirects the browser there; the 20–65 MB body does not pass through the Netlify function. Mirror and official metadata endpoints are tried in order, avoiding browser CORS/COEP restrictions and networks that cannot reach `huggingface.co` directly.
- Candidate order is same-origin proxy, optional configured base URL, then official Hugging Face. Every source must return an OK response and a plausible model/config payload.
- `vits-web.predict()` remains the local inference engine. It reads the validated files from the same `piper` OPFS directory and therefore does not perform its defective downloader path.

## Data and privacy

Only static public `.onnx` and `.onnx.json` files are requested. Subtitle text is passed only to the in-browser ONNX/phonemizer runtime and is never included in model requests or sent to the proxy.

## Failure behavior

- Downloads retry the next source and report aggregate progress.
- Invalid stale OPFS entries are overwritten.
- A failure using a previously cached pair triggers one forced refresh before surfacing an error.
- Download errors are distinguished from inference errors in localized UI messages and retain source diagnostics in the browser console.

## Verification

TDD covers curated paths, candidate order, payload validation, and source fallback. Validation also includes the complete Vitest suite, TypeScript, ESLint, Next.js production build, a production deployment, and live URL checks.
