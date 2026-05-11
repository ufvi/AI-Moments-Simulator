/**
 * functions/api/[[path]].js
 * Cloudflare Pages Functions — moments backend
 *
 * 绑定（已在 Pages Dashboard 配置好）：
 *   KV namespace  → MOMENTS_KV
 *   R2 bucket     → MOMENTS_R2
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}

function err(msg, status = 400) {
    return json({ error: msg }, status);
}

export async function onRequest(context) {
    const { request, env } = context;

    // ── Preflight ──
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ══════════════════════════════════════════
    // GET /api/data
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path === '/api/data') {
        const [accounts, posts, aiConfig, updatedAt] = await Promise.all([
            env.MOMENTS_KV.get('accounts', 'json'),
            env.MOMENTS_KV.get('posts', 'json'),
            env.MOMENTS_KV.get('aiConfig', 'json'),
            env.MOMENTS_KV.get('updatedAt'),
        ]);
        return json({
            accounts: accounts ?? [],
            posts: posts ?? [],
            aiConfig: aiConfig ?? null,
            _meta: { updatedAt: updatedAt ? Number(updatedAt) : 0 },
        });
    }

    // ══════════════════════════════════════════
    // GET /api/timestamp
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path === '/api/timestamp') {
        const ts = await env.MOMENTS_KV.get('updatedAt');
        return json({ updatedAt: ts ? Number(ts) : 0 });
    }

    // ══════════════════════════════════════════
    // POST /api/data
    // Body: { accounts, posts, localTs, force? }
    // ══════════════════════════════════════════
    if (request.method === 'POST' && path === '/api/data') {
        let body;
        try { body = await request.json(); }
        catch { return err('Invalid JSON'); }

        const { accounts, posts, localTs, force } = body;
        if (!Array.isArray(accounts) || !Array.isArray(posts)) {
            return err('accounts and posts must be arrays');
        }

        if (!force) {
            const cloudTs = await env.MOMENTS_KV.get('updatedAt');
            const cloudNum = cloudTs ? Number(cloudTs) : 0;
            if (cloudNum >= localTs) {
                return json({ skipped: true, reason: 'cloud_is_newer', cloudTs: cloudNum });
            }
        }

        const nowTs = localTs ?? Date.now();
        await Promise.all([
            env.MOMENTS_KV.put('accounts', JSON.stringify(accounts)),
            env.MOMENTS_KV.put('posts', JSON.stringify(posts)),
            env.MOMENTS_KV.put('updatedAt', String(nowTs)),
        ]);
        return json({ skipped: false, updatedAt: nowTs });
    }

    // ══════════════════════════════════════════
    // POST /api/aiconfig
    // ══════════════════════════════════════════
    if (request.method === 'POST' && path === '/api/aiconfig') {
        let body;
        try { body = await request.json(); }
        catch { return err('Invalid JSON'); }
        await env.MOMENTS_KV.put('aiConfig', JSON.stringify(body));
        return json({ ok: true });
    }

    // ══════════════════════════════════════════
    // GET /api/aiconfig
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path === '/api/aiconfig') {
        const cfg = await env.MOMENTS_KV.get('aiConfig', 'json');
        return json(cfg ?? null);
    }

    // ══════════════════════════════════════════
    // PUT /api/media/:mediaId  → 上传图片到 R2
    // ══════════════════════════════════════════
    if (request.method === 'PUT' && path.startsWith('/api/media/')) {
        const mediaId = decodeURIComponent(path.slice('/api/media/'.length));
        if (!mediaId) return err('mediaId required');

        const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream';
        const blob = await request.arrayBuffer();
        await env.MOMENTS_R2.put(`media/${mediaId}`, blob, {
            httpMetadata: { contentType },
        });

        const publicUrl = `${url.origin}/api/media/${encodeURIComponent(mediaId)}`;
        return json({ url: publicUrl });
    }

    // ══════════════════════════════════════════
    // GET /api/media/:mediaId  → 读取图片
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path.startsWith('/api/media/')) {
        const mediaId = decodeURIComponent(path.slice('/api/media/'.length));
        const obj = await env.MOMENTS_R2.get(`media/${mediaId}`);
        if (!obj) return new Response('Not found', { status: 404, headers: CORS });

        const headers = new Headers(CORS);
        headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers });
    }

    // ══════════════════════════════════════════
    // DELETE /api/media/:mediaId
    // ══════════════════════════════════════════
    if (request.method === 'DELETE' && path.startsWith('/api/media/')) {
        const mediaId = decodeURIComponent(path.slice('/api/media/'.length));
        await env.MOMENTS_R2.delete(`media/${mediaId}`);
        return json({ ok: true });
    }

    return new Response('Not found', { status: 404, headers: CORS });
}
