// Fixed-object, read-only availability endpoint. No credentials or arbitrary keys.
const KEY = 'availability.json';
const MAX_BYTES = 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD',
  'X-Content-Type-Options': 'nosniff',
};
function failure(status, code, head = false, extra = {}) {
  return new Response(head ? null : JSON.stringify({ error: code }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', ...extra },
  });
}
export async function onRequest({ request, env }) {
  const head = request.method === 'HEAD';
  if (request.method !== 'GET' && !head) {
    return failure(405, 'method_not_allowed', false, { Allow: 'GET, HEAD' });
  }
  if (!env.AVAILABILITY_BUCKET) return failure(503, 'storage_unavailable', head);
  try {
    const object = await env.AVAILABILITY_BUCKET.get(KEY);
    if (!object) return failure(503, 'availability_not_published', head);
    if (object.size > MAX_BYTES) return failure(502, 'invalid_availability', head);
    const text = await object.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) {
      return failure(502, 'invalid_availability', head);
    }
    const data = JSON.parse(text);
    // Validate transport only. Freshness, sequence and availability policy remain
    // the consumer's responsibility; never invent or refresh source timestamps.
    if (data?.v !== 2 || !Number.isSafeInteger(data.seq) || data.seq < 0 ||
        typeof data.checked_at !== 'string' || !Number.isFinite(Date.parse(data.checked_at)) ||
        !Array.isArray(data.out) || !data.out.every(id => Number.isSafeInteger(id) && id > 0)) {
      return failure(502, 'invalid_availability', head);
    }
    const headers = new Headers({ ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(head ? null : text, { status: 200, headers });
  } catch {
    return failure(503, 'availability_unavailable', head);
  }
}
