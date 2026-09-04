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

// 解析 media path：兼容旧格式 ns/mediaId 和新格式 base64 编码
function resolveR2Key(raw) {
    if (raw.includes('/')) {
        return { key: `media/${raw}`, raw };
    }
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    try {
        const decoded = atob(b64);
        const sep = decoded.indexOf('|||');
        if (sep === -1) return null;
        return { key: `media/${decoded.slice(0, sep)}/${decoded.slice(sep + 3)}`, raw };
    } catch { return null; }
}

// 解析 HTTP Range 头，返回 { start, end } 或 null
function parseRange(range, fileSize) {
    if (!range || !fileSize) return null;
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m) return null;
    let s = m[1] ? Number(m[1]) : 0;
    let e = m[2] ? Number(m[2]) : fileSize - 1;
    if (isNaN(s) || isNaN(e)) return null;
    return { start: s, end: Math.min(e, fileSize - 1) };
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
    // GET /api/envcheck → 运行环境自检（看绑定是否真的注入；诊断用，不影响业务）
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path === '/api/envcheck') {
        return json({
            envKeys: Object.keys(env || {}),
            hasR2: !!(env && env.MOMENTS_R2),
            hasKV: !!(env && env.MOMENTS_KV),
            r2Type: env && env.MOMENTS_R2 ? typeof env.MOMENTS_R2 : null
        });
    }

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
    // mediaId 兼容旧格式 ns/mediaId 和新格式 base64 编码
    // ══════════════════════════════════════════
    if (request.method === 'PUT' && path.startsWith('/api/media/')) {
        const raw = decodeURIComponent(path.slice('/api/media/'.length));
        if (!raw) return err('mediaId required');
        const r2 = resolveR2Key(raw);
        if (!r2) return err('invalid media id');

        const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream';
        const blob = await request.arrayBuffer();
        await env.MOMENTS_R2.put(r2.key, blob, {
            httpMetadata: { contentType },
        });

        const publicUrl = `${url.origin}/api/media/${encodeURIComponent(r2.raw)}`;
        return json({ url: publicUrl });
    }

    // ══════════════════════════════════════════
    // GET /api/media/:mediaId  → 读取（支持 Range 请求用于视频流）
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path.startsWith('/api/media/')) {
        const raw = decodeURIComponent(path.slice('/api/media/'.length));
        const r2 = resolveR2Key(raw);
        if (!r2) return err('invalid media id');

        const rangeHeader = request.headers.get('Range');
        if (rangeHeader) {
            const head = await env.MOMENTS_R2.head(r2.key);
            if (!head) return new Response('Not found', { status: 404, headers: CORS });
            const r = parseRange(rangeHeader, head.size);
            if (r) {
                const length = r.end - r.start + 1;
                const obj = await env.MOMENTS_R2.get(r2.key, { range: { offset: r.start, length } });
                if (!obj) return new Response('Not found', { status: 404, headers: CORS });
                const h = new Headers(CORS);
                h.set('Content-Type', head.httpMetadata?.contentType ?? 'application/octet-stream');
                h.set('Content-Range', `bytes ${r.start}-${r.end}/${head.size}`);
                h.set('Content-Length', String(length));
                h.set('Accept-Ranges', 'bytes');
                h.set('Cache-Control', 'public, max-age=31536000, immutable');
                return new Response(obj.body, { status: 206, headers: h });
            }
        }

        const obj = await env.MOMENTS_R2.get(r2.key);
        if (!obj) return new Response('Not found', { status: 404, headers: CORS });
        const headers = new Headers(CORS);
        headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers });
    }

    // ══════════════════════════════════════════
    // DELETE /api/media/:mediaId
    // ══════════════════════════════════════════
    if (request.method === 'DELETE' && path.startsWith('/api/media/')) {
        const raw = decodeURIComponent(path.slice('/api/media/'.length));
        const r2 = resolveR2Key(raw);
        if (!r2) return err('invalid media id');
        await env.MOMENTS_R2.delete(r2.key);
        return json({ ok: true });
    }

    // ══════════════════════════════════════════
    // GET /api/share-media/:token  → 读取分享媒体（支持 Range）
    // token = urlsafe-base64(ns + '|||' + mediaId)
    // ══════════════════════════════════════════
    if (request.method === 'GET' && path.startsWith('/api/share-media/')) {
        const token = decodeURIComponent(path.slice('/api/share-media/'.length));
        const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(b64);
        const sep = decoded.indexOf('|||');
        if (sep === -1) return err('invalid token');
        const ns = decoded.slice(0, sep);
        const mediaId = decoded.slice(sep + 3);
        const r2key = `media/${ns}/${mediaId}`;

        const rangeHeader = request.headers.get('Range');
        if (rangeHeader) {
            const head = await env.MOMENTS_R2.head(r2key);
            if (!head) return new Response('Not found', { status: 404, headers: CORS });
            const r = parseRange(rangeHeader, head.size);
            if (r) {
                const length = r.end - r.start + 1;
                const obj = await env.MOMENTS_R2.get(r2key, { range: { offset: r.start, length } });
                if (!obj) return new Response('Not found', { status: 404, headers: CORS });
                const h = new Headers(CORS);
                h.set('Content-Type', head.httpMetadata?.contentType ?? 'application/octet-stream');
                h.set('Content-Range', `bytes ${r.start}-${r.end}/${head.size}`);
                h.set('Content-Length', String(length));
                h.set('Accept-Ranges', 'bytes');
                h.set('Cache-Control', 'public, max-age=31536000, immutable');
                return new Response(obj.body, { status: 206, headers: h });
            }
        }

        const obj = await env.MOMENTS_R2.get(r2key);
        if (!obj) return new Response('Not found', { status: 404, headers: CORS });
        const headers = new Headers(CORS);
        headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers });
    }

    return new Response('Not found', { status: 404, headers: CORS });
}