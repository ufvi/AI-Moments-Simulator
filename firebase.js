import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage, ref as sref, uploadBytes, getDownloadURL, getBlob, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    databaseURL: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const storage = getStorage(firebaseApp);

// 递归清除 undefined → null（Firebase 不接受 undefined）
function cleanForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (k, v) => v === undefined ? null : v));
}

// ─────────────────────────────────────────────
// 节流上传（普通写操作，带节流防抖）
// ─────────────────────────────────────────────
let syncTimer = null;
window._fbSyncData = function (accounts, posts) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
        try {
            if (window._onLocalSync) window._onLocalSync();
            const nowTs = Date.now();
            await set(ref(db, 'moments/accounts'), cleanForFirebase(accounts));
            await set(ref(db, 'moments/posts'), cleanForFirebase(posts));
            // 写入元数据时间戳
            await set(ref(db, 'moments/_meta/updatedAt'), nowTs);
            console.log('Firebase sync OK', new Date().toLocaleTimeString());
        } catch (e) {
            console.warn('Firebase sync failed:', e);
        }
    }, 1500);
};

// ─────────────────────────────────────────────
// 读取云端元数据（仅时间戳，轻量）
// ─────────────────────────────────────────────
window._fbGetCloudTimestamp = async function () {
    try {
        const snap = await get(ref(db, 'moments/_meta/updatedAt'));
        return snap.exists() ? snap.val() : 0;
    } catch (e) {
        console.warn('获取云端时间戳失败:', e);
        return 0;
    }
};

// ─────────────────────────────────────────────
// 带时间戳比对的安全上传
// 仅当 localTs > cloudTs（本地比云端新）才执行上传
// force=true 时跳过比对，强制上传（用于用户主动触发）
// ─────────────────────────────────────────────
window._fbSyncWithTimestampCheck = async function (accounts, posts, localTs, force) {
    try {
        if (!force) {
            const cloudTs = await window._fbGetCloudTimestamp();
            if (cloudTs >= localTs) {
                console.log(`⏭️ 跳过上传：云端(${new Date(cloudTs).toLocaleTimeString()}) >= 本地(${new Date(localTs).toLocaleTimeString()})`);
                return { skipped: true, reason: 'cloud_is_newer' };
            }
        }

        if (window._onLocalSync) window._onLocalSync();
        await set(ref(db, 'moments/accounts'), cleanForFirebase(accounts));
        await set(ref(db, 'moments/posts'), cleanForFirebase(posts));
        await set(ref(db, 'moments/_meta/updatedAt'), localTs);
        console.log('✅ 时间戳保护上传成功', new Date(localTs).toLocaleTimeString());
        return { skipped: false };
    } catch (e) {
        console.warn('Firebase timestamped sync failed:', e);
        return { skipped: false, error: e };
    }
};

// ─────────────────────────────────────────────
// 加载数据（初始化用）
// ─────────────────────────────────────────────
window._fbLoadData = async function () {
    try {
        console.log('📡 开始从Firebase读取数据...');
        const snap = await get(ref(db, 'moments'));
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

// ─────────────────────────────────────────────
// 强制拉取（忽略本地缓存，直接覆盖）
// 供"强制从云端拉取"设置项调用
// ─────────────────────────────────────────────
window._fbForceLoad = async function () {
    try {
        console.log('🔄 强制从云端拉取数据...');
        const snap = await get(ref(db, 'moments'));
        if (snap.exists()) {
            const val = snap.val();
            // 返回云端时间戳供调用方更新本地记录
            val._cloudTs = val._meta?.updatedAt || 0;
            return val;
        }
        return null;
    } catch (e) {
        console.warn('强制拉取失败:', e);
        return null;
    }
};

// ─────────────────────────────────────────────
// 实时监听云端变化（其他设备修改时自动刷新）
// ─────────────────────────────────────────────
window._fbListenChanges = function (onAccountsChange, onPostsChange) {
    onValue(ref(db, 'moments/accounts'), snap => {
        if (snap.exists()) onAccountsChange(snap.val());
    });
    onValue(ref(db, 'moments/posts'), snap => {
        if (snap.exists()) onPostsChange(snap.val());
    });
};

// ─────────────────────────────────────────────
// AI 配置手动上传（仅上传 aiConfig，不触发其他数据同步）
// ─────────────────────────────────────────────
window._fbUploadAIConfig = async function (aiConfig) {
    try {
        await set(ref(db, 'moments/aiConfig'), cleanForFirebase(aiConfig));
        const nowTs = Date.now();
        await set(ref(db, 'moments/_meta/updatedAt'), nowTs);
        console.log('☁️ AI配置已上传', new Date().toLocaleTimeString());
        return true;
    } catch (e) {
        console.warn('AI配置上传失败:', e);
        return false;
    }
};

// ─────────────────────────────────────────────
// AI 配置手动拉取（仅拉取 aiConfig，不触发其他数据同步）
// ─────────────────────────────────────────────
window._fbPullAIConfig = async function () {
    try {
        const snap = await get(ref(db, 'moments/aiConfig'));
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

// ─────────────────────────────────────────────
// 上传媒体文件到Storage，返回下载URL
// ─────────────────────────────────────────────
window._fbUploadMedia = async function (mediaId, blob, mimeType) {
    try {
        const fileRef = sref(storage, 'moments/media/' + mediaId);
        await uploadBytes(fileRef, blob, { contentType: mimeType });
        const url = await getDownloadURL(fileRef);
        return url;
    } catch (e) {
        console.warn('Storage upload failed:', e);
        return null;
    }
};

// 获取媒体下载URL
window._fbGetMediaUrl = async function (mediaId) {
    try {
        const fileRef = sref(storage, 'moments/media/' + mediaId);
        return await getDownloadURL(fileRef);
    } catch (e) {
        return null;
    }
};

// 直接从 Firebase Storage 下载 blob（绕过 CORS，使用 SDK 鉴权）
window._fbDownloadMedia = async function (mediaId) {
    try {
        const fileRef = sref(storage, 'moments/media/' + mediaId);
        return await getBlob(fileRef);
    } catch (e) {
        console.warn('Storage downloadBlob failed:', e);
        return null;
    }
};

// ─────────────────────────────────────────────
// 即时同步（无节流，供导入场景使用）
// 同样写入时间戳
// ─────────────────────────────────────────────
window._fbSyncImmediate = async function (accounts, posts) {
    try {
        clearTimeout(syncTimer);
        if (window._onLocalSync) window._onLocalSync();
        const nowTs = Date.now();
        await set(ref(db, "moments/accounts"), cleanForFirebase(accounts));
        await set(ref(db, "moments/posts"), cleanForFirebase(posts));
        await set(ref(db, 'moments/_meta/updatedAt'), nowTs);
        console.log("Firebase sync OK (immediate)", new Date().toLocaleTimeString());
        return nowTs;
    } catch (e) {
        console.warn("Firebase sync (immediate) failed:", e);
        return null;
    }
};

// 删除Storage中的媒体文件
window._fbDeleteMedia = async function (mediaId) {
    try {
        const fileRef = sref(storage, 'moments/media/' + mediaId);
        await deleteObject(fileRef);
    } catch (e) {
        // 忽略不存在的文件
    }
};

console.log('✅ Firebase 已连接（时间戳保护模式）');
window._fbReady = true;
if (window._fbReadyResolve) window._fbReadyResolve();
