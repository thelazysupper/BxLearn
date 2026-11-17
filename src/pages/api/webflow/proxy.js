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
