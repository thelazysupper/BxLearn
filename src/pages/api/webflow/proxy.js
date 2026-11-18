export const prerender = false;

export async function GET({ request }) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint') || '/v2/sites';
  const token = (request.headers.get('x-webflow-token') || '').trim();

  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing Webflow API token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!endpoint.startsWith('/v2/')) {
    return new Response(JSON.stringify({ error: 'Invalid Webflow v2 endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const wfRes = await fetch(`https://api.webflow.com${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    const wfData = await wfRes.json().catch(() => ({}));
    return new Response(JSON.stringify(wfData), {
      status: wfRes.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Webflow API proxy error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function md5Hex(bytes) {
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 8) >> 6 << 6) + 64;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, bitLen >>> 0, true);
  view.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padLen; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const dTemp = D;
      D = C;
      C = B;
      const sum = (A + F + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      const rot = (sum << S[i]) | (sum >>> (32 - S[i]));
      B = (B + rot) >>> 0;
      A = dTemp;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map(w => {
    let h = '';
    for (let i = 0; i < 4; i++) h += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return h;
  }).join('');
}

export async function POST({ request }) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint') || '';
  const token = (request.headers.get('x-webflow-token') || '').trim();
  const rawName = request.headers.get('x-file-name') || `screenshot-${Date.now()}.png`;
  let fileName = rawName;
  try { fileName = decodeURIComponent(rawName); } catch {}
  const contentType = request.headers.get('content-type') || 'image/png';

  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing Webflow API token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!/^\/v2\/sites\/[^/]+\/assets$/.test(endpoint)) {
    return new Response(JSON.stringify({ error: 'Invalid Webflow assets upload endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const fileHash = md5Hex(bytes);

    const createRes = await fetch(`https://api.webflow.com${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ fileName, fileHash })
    });
    const assetMeta = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !assetMeta.uploadUrl) {
      return new Response(JSON.stringify({
        error: assetMeta.message || assetMeta.error || `Webflow asset create failed (${createRes.status})`
      }), {
        status: createRes.status || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const form = new FormData();
    const details = assetMeta.uploadDetails || {};
    Object.entries(details).forEach(([k, v]) => {
      if (v !== undefined && v !== null) form.append(k, String(v));
    });
    form.append('file', new Blob([bytes], { type: contentType }), fileName);

    const s3Res = await fetch(assetMeta.uploadUrl, { method: 'POST', body: form });
    if (!s3Res.ok) {
      const s3Err = await s3Res.text().catch(() => '');
      return new Response(JSON.stringify({
        error: `Asset S3 upload failed (${s3Res.status}): ${s3Err.slice(0, 200)}`
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      id: assetMeta.id,
      hostedUrl: assetMeta.hostedUrl || assetMeta.assetUrl || '',
      assetUrl: assetMeta.assetUrl || assetMeta.hostedUrl || '',
      fileName
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Webflow asset upload error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
