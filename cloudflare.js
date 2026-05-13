import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

/**
 * 数据存储：Firebase Realtime Database（实时监听）
 * 图片存储：Cloudflare R2（国内访问稳定）
 *
 * 命名空间通过 URL 参数 ?ns=xxx 指定，默认 'moments'
 * 例：index.html?ns=moments2
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
            var val = snap.val();
            console.log('☁️ AI配置已拉取');
            return val;
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
            var val = snap.val();
            console.log('☁️ 收藏语录已拉取');
            return val;
        }
        return [];
    } catch (e) {
        console.warn('收藏语录拉取失败:', e);
        return [];
    }
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

} // if (db)

// ════════════════════════════════════════════════════════════
// 图片部分 — 全部走 Cloudflare R2
// 图片路径带命名空间前缀，不同 ns 的图片完全隔离
// ════════════════════════════════════════════════════════════

window._fbUploadMedia = async function (mediaId, blob, mimeType) {
    try {
        const nsMediaId = `${NAMESPACE}/${mediaId}`;
        const base = WORKER_BASE_URL || location.origin;
        const res = await fetch(`${base}/api/media/${encodeURIComponent(nsMediaId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: blob,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.url;
    } catch (e) {
        console.warn('R2 upload failed:', e);
        return null;
    }
};

window._fbGetMediaUrl = async function (mediaId) {
    const base = WORKER_BASE_URL || location.origin;
    return `${base}/api/media/${encodeURIComponent(`${NAMESPACE}/${mediaId}`)}`;
};

window._fbDownloadMedia = async function (mediaId) {
    try {
        const base = WORKER_BASE_URL || location.origin;
        const res = await fetch(`${base}/api/media/${encodeURIComponent(`${NAMESPACE}/${mediaId}`)}`);
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
        await fetch(`${base}/api/media/${encodeURIComponent(`${NAMESPACE}/${mediaId}`)}`, {
            method: 'DELETE',
        });
    } catch (e) {
        // 忽略不存在的文件
    }
};
