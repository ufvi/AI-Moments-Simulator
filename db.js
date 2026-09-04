(function() {
    // IndexedDB 数据库（含 backup、media 和新增的 appData 仓库）
    // 在外部声明一个变量，用来缓存 Promise
    // 等待Cloudflare模块就绪
    const _fbReadyPromise = new Promise(resolve => {
        if (window._fbReady) { resolve(); }
        else { window._fbReadyResolve = resolve; }
    });

    let dbPromiseCache = null;

    function openDB() {
        // 如果已经有正在打开或已打开的 Promise，直接返回复用
        if (dbPromiseCache) {
            return dbPromiseCache;
        }

        // 否则，创建一个新的 Promise 并缓存起来
        dbPromiseCache = new Promise((resolve, reject) => {
            const req = indexedDB.open('MomentsMediaDB', 3);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('backup')) db.createObjectStore('backup', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('appData')) db.createObjectStore('appData', { keyPath: 'key' });
            };

            req.onsuccess = () => resolve(req.result);

            req.onerror = () => {
                // 如果打开失败，把缓存清空，允许下次重试
                dbPromiseCache = null;
                reject(req.error);
            };
        });

        return dbPromiseCache;
    }

    // --- 新增：App 核心数据的异步读写工具 ---
    async function saveAppData(key, data) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('appData', 'readwrite');
                tx.objectStore('appData').put({ key, data });
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error('Save AppData failed:', e);
        }
    }

    async function getAppData(key) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('appData', 'readonly');
                const req = tx.objectStore('appData').get(key);
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error('Get AppData failed:', e);
            return null;
        }
    }
    // ----------------------------------------

    const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;

    // ── 媒体云端上传跟踪 ──
    // 上传失败不丢数据：blob 已在 IndexedDB 落盘，把 mediaId 记入“待补传”清单，
    // 下次打开页面/下次发布/手动上传时自动补传，成功后移除。
    const _inflightUploads = new Set();
    let _pendingMediaCache = null;

    function pendingMediaKey() { return window.App.NS + 'pending_media'; }
    function loadPendingMedia() {
        try { return JSON.parse(localStorage.getItem(pendingMediaKey()) || '[]'); } catch (e) { return []; }
    }
    function savePendingMedia(arr) {
        try { localStorage.setItem(pendingMediaKey(), JSON.stringify(arr)); } catch (e) { }
    }
    function _readPending() {
        if (!_pendingMediaCache) _pendingMediaCache = loadPendingMedia();
        return _pendingMediaCache;
    }
    function _writePending() { savePendingMedia(_pendingMediaCache); }
    function addPendingMedia(id) {
        const arr = _readPending();
        if (arr.indexOf(id) === -1) { arr.push(id); _writePending(); }
    }
    function removePendingMedia(id) {
        const arr = _readPending();
        const i = arr.indexOf(id);
        if (i !== -1) { arr.splice(i, 1); _writePending(); }
    }
    function getPendingMediaIds() { return _readPending().slice(); }

    // 失败原因记录（用于帖子提示条显示 HTTP/超时/网络等信息）
    function _readMediaMeta() {
        if (!_pendingMediaCache) _pendingMediaCache = loadPendingMedia(); // 保持读取顺序一致（占位，无副作用）
        try { return JSON.parse(localStorage.getItem(window.App.NS + 'pending_media_meta') || '{}'); } catch (e) { return {}; }
    }
    function _writeMediaMeta(m) {
        try { localStorage.setItem(window.App.NS + 'pending_media_meta', JSON.stringify(m)); } catch (e) { }
    }
    function noteMediaUploadFail(id) {
        const m = _readMediaMeta();
        const rec = m[id] || { tries: 0 };
        rec.tries = (rec.tries || 0) + 1;
        const e = window._fbLastMediaErr || {};
        rec.kind = e.kind || 'unknown';
        rec.http = e.http || null;
        rec.detail = e.detail || null;
        rec.at = Date.now();
        m[id] = rec;
        _writeMediaMeta(m);
    }
    function clearMediaMeta(id) {
        const m = _readMediaMeta();
        if (m[id]) { delete m[id]; _writeMediaMeta(m); }
    }
    function getPendingMediaMeta() { return _readMediaMeta(); }

    // 等待当前所有在途媒体上传结束，返回每个结果的布尔数组（true=成功）
    async function flushMediaUploads() {
        const items = Array.from(_inflightUploads);
        if (!items.length) return [];
        const results = await Promise.all(items.map(p => p.then(v => !!v).catch(() => false)));
        return results;
    }

    // 针对指定 id 列表补传媒体（失败的不移除，等待下次机会）；空列表 = 全部待补传
    // 并发调用全部“排队”依次执行：手动点重传一定真正发请求，不会被后台自动重试挡住
    let _retryChain = Promise.resolve();
    async function _doRetryPendingMedia(ids) {
        const list = ids ? ids.slice() : getPendingMediaIds();
        if (!list.length || !window._fbUploadMedia) return 0;
        let okCount = 0;
        for (let i = 0; i < list.length; i++) {
            const id = list[i];
            try {
                const rec = await getMedia(id);
                if (!rec || !rec.blob) continue; // 本地已无 blob：交给下一次发布重建
                const mimeType = rec.blob.type || (rec.type === 'video' ? 'video/mp4' : 'image/jpeg');
                const isLarge = rec.blob.size > LARGE_FILE_THRESHOLD;
                const url = await window._fbUploadMedia(id, rec.blob, mimeType, function () { });
                if (url) {
                    removePendingMedia(id);
                    clearMediaMeta(id);
                    okCount++;
                    if (isLarge) console.log('☁️ 补传成功:', id);
                } else {
                    console.warn('☁️ 补传失败（稍后自动再试）:', id);
                    noteMediaUploadFail(id);
                }
            } catch (e) {
                console.warn('☁️ 补传异常:', id, e);
            }
        }
        return okCount;
    }
    function retryPendingMedia(ids) {
        const task = _retryChain.then(function () { return _doRetryPendingMedia(ids); });
        _retryChain = task.catch(function () { });
        return task;
    }

    // 把“待补传”清单里的所有媒体逐个补传
    async function retryPendingMediaUploads() {
        return retryPendingMedia(getPendingMediaIds());
    }

    async function saveMedia(id, blob, type) {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('media', 'readwrite');
            tx.objectStore('media').put({ id, blob, type });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        if (window._fbUploadMedia) {
            const mimeType = blob.type || (type === 'image' ? 'image/jpeg' : 'video/mp4');
            const isLarge = blob.size > LARGE_FILE_THRESHOLD;
            if (isLarge) {
                window.App.showProgress('☁️ 上传中 0%');
            }
            const upPromise = window._fbUploadMedia(id, blob, mimeType, function (loaded, total) {
                if (isLarge) {
                    window.App.showUploadProgress(loaded, total);
                }
            }).then(function (url) {
                if (url) {
                    console.log('☁️ 媒体已上传:', id);
                    removePendingMedia(id);
                    clearMediaMeta(id);
                    if (isLarge) window.App.hideProgress();
                    return true;
                }
                console.warn('☁️ 媒体上传失败，已记入待补传:', id);
                addPendingMedia(id);
                noteMediaUploadFail(id);
                if (isLarge) window.App.hideProgress();
                return false;
            }).catch(function (e) {
                console.warn('☁️ 媒体上传异常，已记入待补传:', id, e);
                addPendingMedia(id);
                noteMediaUploadFail(id);
                if (isLarge) window.App.hideProgress();
                return false;
            });
            _inflightUploads.add(upPromise);
            upPromise.then(function () { _inflightUploads.delete(upPromise); });
            upPromise.catch(function () { });
        }
    }
    async function getMedia(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('media', 'readonly');
            const req = tx.objectStore('media').get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }
    async function deleteMedia(id) {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('media', 'readwrite');
            tx.objectStore('media').delete(id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        // 如果它还在“待补传”清单里，一并移除（已删除就不需要补传了）
        removePendingMedia(id);
        clearMediaMeta(id);
        // 同时删除Storage里的文件
        if (window._fbDeleteMedia) window._fbDeleteMedia(id);
    }

    const mediaCache = new Map();
    async function loadMediaUrl(id) {
        if (mediaCache.has(id)) return mediaCache.get(id).url;
        // 先查本地
        const rec = await getMedia(id);
        if (rec) {
            const url = URL.createObjectURL(rec.blob);
            mediaCache.set(id, { blob: rec.blob, url });
            return url;
        }
        // 本地没有，去Cloudflare Storage拿
        if (window._fbGetMediaUrl) {
            const url = await window._fbGetMediaUrl(id);
            if (url) {
                // 缓存URL，不下载blob（节省内存）
                mediaCache.set(id, { blob: null, url });
                return url;
            }
        }
        return null;
    }
    function revokeMediaUrl(id) {
        const c = mediaCache.get(id);
        if (c) {
            URL.revokeObjectURL(c.url);
            mediaCache.delete(id);
        }
    }
    function clearMediaCache() {
        for (let [, c] of mediaCache) URL.revokeObjectURL(c.url);
        mediaCache.clear();
    }

    // 懒加载观察器：定义在 IIFE 内部，这样才能访问到 loadMediaUrl
    const lazyMediaObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            const mid = el.dataset.mediaId;
            if (!mid) return;

            // 加载媒体
            loadMediaUrl(mid).then(url => {
                if (!url) return;
                if (el.tagName === 'IMG') {
                    el.src = url;
                    el.style.display = 'block';
                } else if (el.tagName === 'VIDEO') {
                    el.src = url;
                    el.load();
                } else if (el.tagName === 'DIV') {
                    // 图片 wrapper div —— 找到内部的 img 并赋值
                    const img = el.querySelector('img[data-media-id]');
                    if (img) {
                        img.src = url;
                        img.style.display = 'block';
                        el.classList.add('loaded');
                    }
                }
            }).catch(() => { });

            // 加载后取消观察，避免重复加载
            lazyMediaObserver.unobserve(el);
        });
    }, {
        rootMargin: '100px'
    });

    // 自动备份
    async function autoBackup() {
        try {
            const db = await openDB();
            const backupData = { key: 'latest', accounts: window.App.accounts, posts: window.App.posts, currentId: window.App.currentId, aiConfig: window.App.aiConfig, aiPresets: window.App.aiPresets, activePresetId: window.App.activePresetId, timestamp: Date.now() };
            const tx = db.transaction('backup', 'readwrite');
            tx.objectStore('backup').put(backupData);
            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
            localStorage.setItem(window.App.NS + 'backup_ts', backupData.timestamp);
        } catch (e) { }
    }

    async function restoreBackupIfNewer() {
        try {
            const db = await openDB();
            const tx = db.transaction('backup', 'readonly');
            const req = tx.objectStore('backup').get('latest');
            const backup = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = reject; });
            if (!backup || !backup.accounts) return false;

            // 判断是否需要恢复：读取 IndexedDB 的账号数据
            const localAcc = await getAppData(window.App.KEY_ACC);
            if (localAcc && localAcc.length > 0) return false;

            if (true) { // 自动恢复
                window.App.accounts = backup.accounts; window.App.saveAccounts();
                window.App.posts = backup.posts; window.App.savePosts();
                window.App.currentId = backup.currentId; localStorage.setItem(window.App.KEY_CUR, window.App.currentId);
                if (backup.aiPresets) { window.App.aiPresets = backup.aiPresets; window.App.activePresetId = backup.activePresetId || backup.aiPresets[0].id; window.App.aiConfig = window.App.aiPresets.find(function(p) { return p.id === window.App.activePresetId; }) || window.App.aiPresets[0]; window.App.saveAIPresets(); }
                localStorage.setItem(window.App.NS + 'backup_ts', backup.timestamp);
                window.App.showToast('✅ 已恢复备份');
                return true;
            }
        } catch (e) { }
        return false;
    }

    setInterval(() => { if (!document.hidden) autoBackup(); }, 300000);
    window.addEventListener('beforeunload', autoBackup);

    // 挂载到全局
    window.App = window.App || {};
    window.App.openDB = openDB;
    window.App.saveAppData = saveAppData;
    window.App.getAppData = getAppData;
    window.App.saveMedia = saveMedia;
    window.App.getMedia = getMedia;
    window.App.deleteMedia = deleteMedia;
    window.App.loadMediaUrl = loadMediaUrl;
    window.App.revokeMediaUrl = revokeMediaUrl;
    window.App.clearMediaCache = clearMediaCache;
    window.App.flushMediaUploads = flushMediaUploads;
    window.App.retryPendingMediaUploads = retryPendingMediaUploads;
    window.App.retryPendingMedia = retryPendingMedia;
    window.App.getPendingMediaIds = getPendingMediaIds;
    window.App.getPendingMediaMeta = getPendingMediaMeta;
    window.App.lazyMediaObserver = lazyMediaObserver;
    window.App.autoBackup = autoBackup;
    window.App.restoreBackupIfNewer = restoreBackupIfNewer;
    window.App._fbReadyPromise = _fbReadyPromise;
})();
