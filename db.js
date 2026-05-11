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

    async function saveMedia(id, blob, type) {
        // 本地IndexedDB存一份
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('media', 'readwrite');
            tx.objectStore('media').put({ id, blob, type });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        // 同时上传到Cloudflare Storage（后台进行，不阻塞发帖）
        if (window._fbUploadMedia) {
            const mimeType = blob.type || (type === 'image' ? 'image/jpeg' : 'video/mp4');
            window._fbUploadMedia(id, blob, mimeType).then(url => {
                if (url) console.log('☁️ 媒体已上传:', id);
            });
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
    window.App.lazyMediaObserver = lazyMediaObserver;
    window.App.autoBackup = autoBackup;
    window.App.restoreBackupIfNewer = restoreBackupIfNewer;
    window.App._fbReadyPromise = _fbReadyPromise;
})();
