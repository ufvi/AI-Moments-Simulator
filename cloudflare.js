import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, get, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

/**
 * 数据存储：Firebase Realtime Database（实时监听）
 * 图片存储：Cloudflare R2（国内访问稳定）
 *
 * 命名空间通过 URL 参数 ?ns=xxx 指定，默认 'moments'
 * 例：index.html?ns=family
 *
 * WORKER_BASE_URL：留空则自动使用当前页面 origin（Pages 同域部署）
 */
const WORKER_BASE_URL = '';
const NAMESPACE = new URLSearchParams(location.search).get('ns') || 'moments';

console.log(`📦 当前命名空间：${NAMESPACE}`);

let db;
try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    console.log('✅ Firebase 已连接（数据）+ Cloudflare R2（图片）');
    window._fbReady = true;
    if (window._fbReadyResolve) window._fbReadyResolve();
} catch (e) {
    console.warn('Firebase 初始化失败，云端功能不可用:', e.message);
    window._fbReady = false;
    if (window._fbReadyResolve) window._fbReadyResolve();
}

function cleanForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (k, v) => v === undefined ? null : v));
}

let syncTimer = null;

if (db) {

// ════════════════════════════════════════════════════════════
// 数据同步（基础）
// ════════════════════════════════════════════════════════════

window._fbSyncData = function (accounts, posts) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
        try {
            if (window._onLocalSync) window._onLocalSync();
            const nowTs = Date.now();
            await set(ref(db, `${NAMESPACE}/accounts`), cleanForFirebase(accounts));
            await set(ref(db, `${NAMESPACE}/posts`), cleanForFirebase(posts));
            await set(ref(db, `${NAMESPACE}/_meta/updatedAt`), nowTs);
            console.log('Firebase sync OK', new Date().toLocaleTimeString());
        } catch (e) {
            console.warn('Firebase sync failed:', e);
        }
    }, 1500);
};

window._fbGetCloudTimestamp = async function () {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/_meta/updatedAt`));
        return snap.exists() ? snap.val() : 0;
    } catch (e) {
        console.warn('获取云端时间戳失败:', e);
        return 0;
    }
};

window._fbSyncWithTimestampCheck = async function (accounts, posts, localTs, force) {
    try {
        const accountsSnap = cleanForFirebase(accounts);
        const postsSnap = cleanForFirebase(posts);

        if (!force) {
            const cloudTs = await window._fbGetCloudTimestamp();
            if (cloudTs >= localTs) {
                console.log(`⏭️ 跳过上传：云端(${new Date(cloudTs).toLocaleTimeString()}) >= 本地(${new Date(localTs).toLocaleTimeString()})`);
                return { skipped: true, reason: 'cloud_is_newer' };
            }
        }

        if (window._onLocalSync) window._onLocalSync();
        await set(ref(db, `${NAMESPACE}/accounts`), accountsSnap);
        await set(ref(db, `${NAMESPACE}/posts`), postsSnap);
        await set(ref(db, `${NAMESPACE}/_meta/updatedAt`), localTs);
        console.log('✅ 时间戳保护上传成功', new Date(localTs).toLocaleTimeString());
        return { skipped: false };
    } catch (e) {
        console.warn('Firebase timestamped sync failed:', e);
        return { skipped: false, error: e };
    }
};

window._fbLoadData = async function () {
    try {
        console.log('📡 开始从Firebase读取数据...');
        const snap = await get(ref(db, NAMESPACE));
        console.log('📡 snap.exists():', snap.exists());
        if (snap.exists()) {
            const val = snap.val();
            console.log('📡 读取成功，accounts数量:', val.accounts?.length, 'posts数量:', val.posts?.length, 'aiConfig:', !!val.aiConfig);
            return val;
        } else {
            console.warn('📡 Firebase里没有数据');
        }
    } catch (e) {
        console.warn('📡 Firebase load failed:', e);
    }
    return null;
};

window._fbForceLoad = async function () {
    try {
        console.log('🔄 强制从云端拉取数据...');
        const snap = await get(ref(db, NAMESPACE));
        if (snap.exists()) {
            const val = snap.val();
            val._cloudTs = val._meta?.updatedAt || 0;
            return val;
        }
        return null;
    } catch (e) {
        console.warn('强制拉取失败:', e);
        return null;
    }
};

window._fbListenChanges = function (onAccountsChange, onPostsChange) {
    onValue(ref(db, `${NAMESPACE}/accounts`), snap => {
        if (snap.exists()) onAccountsChange(snap.val());
    });
    onValue(ref(db, `${NAMESPACE}/posts`), snap => {
        if (snap.exists()) onPostsChange(snap.val());
    });
};

window._fbSyncImmediate = async function (accounts, posts) {
    try {
        clearTimeout(syncTimer);
        if (window._onLocalSync) window._onLocalSync();
        const nowTs = Date.now();
        await set(ref(db, `${NAMESPACE}/accounts`), cleanForFirebase(accounts));
        await set(ref(db, `${NAMESPACE}/posts`), cleanForFirebase(posts));
        await set(ref(db, `${NAMESPACE}/_meta/updatedAt`), nowTs);
        console.log('Firebase sync OK (immediate)', new Date().toLocaleTimeString());
        return nowTs;
    } catch (e) {
        console.warn('Firebase sync (immediate) failed:', e);
        return null;
    }
};

// ════════════════════════════════════════════════════════════
// AI 配置
// ════════════════════════════════════════════════════════════

window._fbUploadAIConfig = async function (data) {
    try {
        await set(ref(db, `${NAMESPACE}/aiConfig`), cleanForFirebase(data));
        console.log('☁️ AI配置已上传', new Date().toLocaleTimeString());
        return true;
    } catch (e) {
        console.warn('AI配置上传失败:', e);
        return false;
    }
};

window._fbPullAIConfig = async function () {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/aiConfig`));
        if (snap.exists()) {
            console.log('☁️ AI配置已拉取');
            return snap.val();
        }
        return null;
    } catch (e) {
        console.warn('AI配置拉取失败:', e);
        return null;
    }
};

window._fbUploadSavedQuotes = async function (savedQuotes) {
    try {
        await set(ref(db, `${NAMESPACE}/savedQuotes`), cleanForFirebase(savedQuotes));
        console.log('☁️ 收藏语录已上传', new Date().toLocaleTimeString());
        return true;
    } catch (e) {
        console.warn('收藏语录上传失败:', e);
        return false;
    }
};

window._fbPullSavedQuotes = async function () {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/savedQuotes`));
        if (snap.exists()) {
            console.log('☁️ 收藏语录已拉取');
            return snap.val();
        }
        return [];
    } catch (e) {
        console.warn('收藏语录拉取失败:', e);
        return [];
    }
};

// ════════════════════════════════════════════════════════════
// 聊天记录（chat.html 用，存在 ${NAMESPACE}/chat/conversations 下）
// ════════════════════════════════════════════════════════════

window._fbChatSync = async function (conversations) {
    try {
        if (window._onLocalSync) window._onLocalSync();
        await set(ref(db, `${NAMESPACE}/chat/conversations`), cleanForFirebase(conversations));
        console.log('💬 聊天记录已同步', new Date().toLocaleTimeString());
        return true;
    } catch (e) {
        console.warn('聊天记录同步失败:', e);
        return false;
    }
};

window._fbChatLoad = async function () {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/chat/conversations`));
        if (snap.exists()) {
            console.log('☁️ 聊天记录已拉取');
            return snap.val();
        }
        return [];
    } catch (e) {
        console.warn('聊天记录拉取失败:', e);
        return [];
    }
};

// ════════════════════════════════════════════════════════════
// 评论（主页面用，存在 ${NAMESPACE}/comments 下）
// ════════════════════════════════════════════════════════════

window._fbLoadComments = async function (postId) {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/comments/${postId}`));
        if (!snap.exists()) return [];
        return Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt);
    } catch (e) {
        console.warn('读取评论失败:', e);
        return [];
    }
};

window._fbAddComment = async function (postId, comment) {
    try {
        const newComment = cleanForFirebase({
            ...comment,
            id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            createdAt: Date.now(),
        });
        await push(ref(db, `${NAMESPACE}/comments/${postId}`), newComment);
        console.log('💬 评论已发布');
        return newComment;
    } catch (e) {
        console.warn('发布评论失败:', e);
        return null;
    }
};

window._fbListenComments = function (postId, onChange) {
    return onValue(ref(db, `${NAMESPACE}/comments/${postId}`), snap => {
        if (!snap.exists()) { onChange([]); return; }
        onChange(Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt));
    });
};

window._fbLoadCommentCounts = async function () {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/comments`));
        if (!snap.exists()) return {};
        const val = snap.val();
        const counts = {};
        for (const postId of Object.keys(val)) {
            counts[postId] = Object.keys(val[postId]).length;
        }
        return counts;
    } catch (e) {
        console.warn('读取评论数失败:', e);
        return {};
    }
};

// ════════════════════════════════════════════════════════════
// 游客账号（主页面用，存在 ${NAMESPACE}/guests 下）
// ════════════════════════════════════════════════════════════

window._fbLoadGuests = async function () {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/guests`));
        if (!snap.exists()) return [];
        return Object.values(snap.val());
    } catch (e) {
        console.warn('读取游客账号失败:', e);
        return [];
    }
};

window._fbSaveGuest = async function (guest) {
    try {
        await set(ref(db, `${NAMESPACE}/guests/${guest.id}`), cleanForFirebase(guest));
        console.log('👤 游客账号已保存');
        return true;
    } catch (e) {
        console.warn('保存游客账号失败:', e);
        return false;
    }
};

window._fbGetGuest = async function (guestId) {
    try {
        const snap = await get(ref(db, `${NAMESPACE}/guests/${guestId}`));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.warn('读取游客账号失败:', e);
        return null;
    }
};

// ════════════════════════════════════════════════════════════
// 分享快照（存在顶层 shares/ 下，与任何命名空间无关）
//
// 数据结构：
//   shares/${postId}/post      ← 帖子快照（每次分享覆盖）
//   shares/${postId}/account   ← 账号快照（每次分享覆盖）
//   shares/${postId}/comments  ← 评论（不覆盖，持续累积）
//   shares/_guests/${guestId}  ← 分享页游客账号
// ════════════════════════════════════════════════════════════

// 主页面调用：写入分享快照，返回分享链接
// accountsMap: { [id]: account }，把所有相关账号一起传入
// share.html 需要用到：发帖人、AI 账号（代写/评论）等
window._fbSharePost = async function (post, accountsMap) {
    try {
        // 把 mediaId 解析成完整 URL（base64 编码，不暴露 ns）
        var snapshot = cleanForFirebase(post);
        if (snapshot.images && snapshot.images.length) {
            snapshot.images = await Promise.all(snapshot.images.map(function (mid) {
                return window._fbGetMediaUrl ? window._fbGetMediaUrl(mid) : mid;
            }));
        }
        if (snapshot.videos && snapshot.videos.length) {
            snapshot.videos = await Promise.all(snapshot.videos.map(function (mid) {
                return window._fbGetMediaUrl ? window._fbGetMediaUrl(mid) : mid;
            }));
        }
        await Promise.all([
            set(ref(db, `shares/${post.id}/post`), snapshot),
            set(ref(db, `shares/${post.id}/accounts`), cleanForFirebase(accountsMap)),
            set(ref(db, `shares/${post.id}/_meta/syncedAt`), Date.now()),
        ]);
        console.log('🔗 分享快照已写入', post.id);
        return `share.html?id=${post.id}`;
    } catch (e) {
        console.warn('分享快照写入失败:', e);
        return null;
    }
};

// share.html 调用：读取分享快照
window._fbLoadShare = async function (postId) {
    try {
        const snap = await get(ref(db, `shares/${postId}`));
        if (!snap.exists()) return null;
        const val = snap.val();
        return {
            post: val.post || null,
            accounts: val.accounts || {},
        };
    } catch (e) {
        console.warn('读取分享快照失败:', e);
        return null;
    }
};

// share.html 调用：读取分享页评论
window._fbLoadShareComments = async function (postId) {
    try {
        const snap = await get(ref(db, `shares/${postId}/comments`));
        if (!snap.exists()) return [];
        return Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt);
    } catch (e) {
        console.warn('读取分享评论失败:', e);
        return [];
    }
};

// share.html 调用：发分享页评论
window._fbAddShareComment = async function (postId, comment) {
    try {
        const newComment = cleanForFirebase({
            ...comment,
            id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            createdAt: Date.now(),
        });
        await push(ref(db, `shares/${postId}/comments`), newComment);
        console.log('💬 分享评论已发布');
        return newComment;
    } catch (e) {
        console.warn('发布分享评论失败:', e);
        return null;
    }
};

// share.html 调用：实时监听分享页评论
window._fbListenShareComments = function (postId, onChange) {
    return onValue(ref(db, `shares/${postId}/comments`), snap => {
        if (!snap.exists()) { onChange([]); return; }
        onChange(Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt));
    });
};

// share.html 调用：保存分享页游客
window._fbSaveShareGuest = async function (guest) {
    try {
        await set(ref(db, `shares/_guests/${guest.id}`), cleanForFirebase(guest));
        console.log('👤 分享页游客已保存');
        return true;
    } catch (e) {
        console.warn('保存分享页游客失败:', e);
        return false;
    }
};

// share.html 调用：读取分享页游客
window._fbGetShareGuest = async function (guestId) {
    try {
        const snap = await get(ref(db, `shares/_guests/${guestId}`));
        return snap.exists() ? snap.val() : null;
    } catch (e) {
        console.warn('读取分享页游客失败:', e);
        return null;
    }
};

} // if (db)

// ════════════════════════════════════════════════════════════
// 图片 — 全部走 Cloudflare R2（与命名空间隔离）
// ════════════════════════════════════════════════════════════

// urlsafe-base64(ns + '|||' + mediaId)，不暴露 ns
function encodeMediaPath(ns, mid) {
    return btoa(ns + '|||' + mid).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 单次上传（小文件 / 分片不可用时的回退）
function _fbUploadSingle(mediaId, blob, mimeType, onProgress) {
    return new Promise((resolve) => {
        try {
            const token = encodeMediaPath(NAMESPACE, mediaId);
            const base = WORKER_BASE_URL || location.origin;
            const url = `${base}/api/media/${token}`;
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            xhr.setRequestHeader('Content-Type', mimeType);
            // 上传必须有个截止时间：否则弱网/挂起的请求会让发布流程无限等待
            // 视频等大文件给更宽裕的时间
            xhr.timeout = blob.size > 5 * 1024 * 1024 ? 300000 : 120000;
            xhr.ontimeout = function () {
                console.warn('R2 upload timeout:', mediaId);
                window._fbLastMediaErr = { id: mediaId, kind: 'timeout' };
                resolve(null);
            };
            if (onProgress && xhr.upload) {
                xhr.upload.onprogress = function (e) {
                    if (e.lengthComputable) onProgress(e.loaded, e.total);
                };
            }
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    window._fbLastMediaErr = null;
                    try { resolve(JSON.parse(xhr.responseText).url); }
                    catch { resolve(xhr.responseText); }
                } else {
                    console.warn('R2 upload failed: HTTP', xhr.status, xhr.responseText);
                    window._fbLastMediaErr = {
                        id: mediaId, kind: 'http', http: xhr.status,
                        detail: 'size=' + blob.size + ' ' + String(xhr.responseText || '').slice(0, 120)
                    };
                    resolve(null);
                }
            };
            xhr.onerror = function () {
                console.warn('R2 upload network error');
                window._fbLastMediaErr = { id: mediaId, kind: 'network' };
                resolve(null);
            };
            xhr.send(blob);
        } catch (e) {
            console.warn('R2 upload failed:', e);
            window._fbLastMediaErr = { id: mediaId, kind: 'exception', detail: String(e && e.message || e) };
            resolve(null);
        }
    });
}

// 分片上传（>15MB 走这里，绕开单请求体限制；每片 8MB）
const MEDIA_CHUNK_THRESHOLD = 15 * 1024 * 1024;
const MEDIA_CHUNK_SIZE = 8 * 1024 * 1024;

async function _fbUploadMultipart(mediaId, blob, mimeType, onProgress) {
    const token = encodeMediaPath(NAMESPACE, mediaId);
    const base = WORKER_BASE_URL || location.origin;
    const head = `${base}/api/media/${token}`;
    async function jfetch(url, opts) {
        const r = await fetch(url, opts);
        let j = null;
        try { j = await r.json(); } catch (e) { }
        if (!r.ok || !j || j.error) {
            const e = new Error((j && j.error) || ('HTTP ' + r.status));
            e.status = r.status;
            throw e;
        }
        return j;
    }
    const created = await jfetch(head + '/multipart', { method: 'POST' });
    const uploadId = created.uploadId;
    const total = Math.max(1, Math.ceil(blob.size / MEDIA_CHUNK_SIZE));
    const parts = [];
    for (let i = 0; i < total; i++) {
        const start = i * MEDIA_CHUNK_SIZE;
        const chunk = blob.slice(start, Math.min(start + MEDIA_CHUNK_SIZE, blob.size));
        const j = await jfetch(`${head}/multipart/${uploadId}/part/${i + 1}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunk
        });
        parts.push({ partNumber: i + 1, etag: j.etag });
        if (onProgress) onProgress(Math.min(blob.size, start + chunk.size), blob.size);
    }
    const done = await jfetch(`${head}/multipart/${uploadId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts })
    });
    return done.url;
}

window._fbUploadMedia = async function (mediaId, blob, mimeType, onProgress) {
    window._fbLastMediaErr = null;
    if (blob.size > MEDIA_CHUNK_THRESHOLD) {
        try {
            return await _fbUploadMultipart(mediaId, blob, mimeType, onProgress);
        } catch (e) {
            console.warn('分片上传失败，回退单次上传:', e);
            const st = (e && e.status) || 0;
            window._fbLastMediaErr = {
                id: mediaId, kind: 'http', http: st,
                detail: 'size=' + blob.size + ' ' + String(e && e.message || e).slice(0, 120)
            };
            // 分片任何失败（含 500：分片接口不可用/运行时问题）都回退单次上传，
            // 只要文件不超过单请求上限（约 100MB）就能成功
            return _fbUploadSingle(mediaId, blob, mimeType, onProgress);
        }
    }
    return _fbUploadSingle(mediaId, blob, mimeType, onProgress);
};

window._fbGetMediaUrl = async function (mediaId) {
    const base = WORKER_BASE_URL || location.origin;
    return `${base}/api/media/${encodeMediaPath(NAMESPACE, mediaId)}`;
};

window._fbDownloadMedia = async function (mediaId) {
    try {
        const base = WORKER_BASE_URL || location.origin;
        const res = await fetch(`${base}/api/media/${encodeMediaPath(NAMESPACE, mediaId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
    } catch (e) {
        console.warn('R2 download failed:', e);
        return null;
    }
};

window._fbDeleteMedia = async function (mediaId) {
    try {
        const base = WORKER_BASE_URL || location.origin;
        await fetch(`${base}/api/media/${encodeMediaPath(NAMESPACE, mediaId)}`, {
            method: 'DELETE',
        });
    } catch (e) {
        // 忽略不存在的文件
    }
};
