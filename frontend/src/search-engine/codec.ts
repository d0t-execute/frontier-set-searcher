/**
 * Generic byte<->text codec shared by every "encode some JSON-safe state as a
 * short, pasteable string" feature this project has -- `shared-state.ts`'s
 * build-result links and `query-code.ts`'s save-this-search codes both just
 * gzip their own JSON and base64url-encode the result. Split out from
 * `shared-state.ts` (which originally had this inline) once `query-code.ts`
 * needed the exact same codec for a differently-shaped payload, rather than
 * duplicating it.
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// A `Uint8Array`'s own `.buffer` is typed as the wider `ArrayBufferLike`
// (it could in principle be a `SharedArrayBuffer`) -- `BodyInit`/`Blob` only
// accept a concrete `ArrayBuffer`, and the DOM lib's generic
// `Uint8Array<ArrayBuffer>` vs. `Uint8Array<ArrayBufferLike>` typings don't
// reconcile cleanly here. An explicit copy into a fresh `ArrayBuffer`
// sidesteps that without an unsound cast.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

// Routed through `Response` rather than `Blob.stream()` (jsdom's own `Blob`
// polyfill -- the test environment this runs under -- doesn't implement
// `.stream()`, unlike every real browser's). `Response`'s body is always
// present for a body constructed from bytes, never null -- the `!` reflects
// that, not an assumption this could fail silently.
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = new Response(toArrayBuffer(bytes)).body!.pipeThrough(
    new CompressionStream('gzip'),
  )
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const decompressed = new Response(toArrayBuffer(bytes)).body!.pipeThrough(
    new DecompressionStream('gzip'),
  )
  return new Uint8Array(await new Response(decompressed).arrayBuffer())
}
