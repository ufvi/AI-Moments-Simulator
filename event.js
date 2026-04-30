(function () {
    var $ = function (s) { return document.querySelector(s); };

    var searchActive = false;

    // ─────────────────────────────────────────────
    // 本地数据修改时间戳（内存中维护）
    // 任何写操作（发布/编辑/导入/手动上传）都应调用 markLocalDirty()
    // ─────────────────────────────────────────────
    var _localDataTs = parseInt(localStorage.getItem('_localDataTs') || '0', 10);
    function markLocalDirty() {
        _localDataTs = Date.now();
        localStorage.setItem('_localDataTs', String(_localDataTs));
    }
    // 暴露给 App 层，供 publish / saveAccounts 等地方调用
    window.App = window.App || {};
    window.App.markLocalDirty = markLocalDirty;

    // ─────────────────────────────────────────────
    // 云端数据加载完成标志
    // false = 初始化阶段，禁止任何自动上传（防止空本地覆盖云端）
    // true  = 云端数据已落地（或确认云端无数据），之后的写操作才允许上传
    // ─────────────────────────────────────────────
    var _cloudLoadDone = false;

    // ─────────────────────────────────────────────
    // 触发带时间戳保护的上传（用户明确操作时调用）
    // ─────────────────────────────────────────────
    async function uploadToCloud(force) {
        // 初始化阶段（云端数据尚未落地）禁止自动上传
        // 手动强制上传（force=true，来自用户点击"上传到云端"）不受此限制
        if (!force && !_cloudLoadDone) {
            console.log('⏸️ 云端数据尚未加载完成，跳过自动上传');
            return;
        }
        if (!window._fbSyncWithTimestampCheck) {
            // 降级到普通节流上传
            if (window._fbSyncData) window._fbSyncData(window.App.accounts, window.App.posts);
            return;
        }
        var result = await window._fbSyncWithTimestampCheck(
            window.App.accounts,
            window.App.posts,
            _localDataTs,
            !!force
        );
        return result;
    }
    window.App.uploadToCloud = uploadToCloud;

    function toggleSearch() {
        var $searchBar = $('#searchBar');
        var $searchInput = $('#searchInput');
        if (!$searchBar || !$searchInput) return;

        searchActive = !searchActive;
        window.App.searchActive = searchActive;
        $searchBar.style.display = searchActive ? 'flex' : 'none';
        if (searchActive) {
            var header = document.querySelector('.header');
            if (header) header.classList.add('search-active');
            $searchInput.focus();
        } else {
            var header = document.querySelector('.header');
            if (header) header.classList.remove('search-active');
            $searchInput.value = '';
            window.App.renderTimeline(true);
        }
    }

    // === 数据导出 ===
    async function exportData() {
        try {
            var imgCount = 0;
            var vidCount = 0;
            var allMediaIds = [];
            (window.App.posts || []).forEach(function (p) {
                (p.images || []).forEach(function (id) { imgCount++; if (allMediaIds.indexOf(id) === -1) allMediaIds.push(id); });
                (p.videos || []).forEach(function (id) { vidCount++; if (allMediaIds.indexOf(id) === -1) allMediaIds.push(id); });
            });

            var data = {
                accounts: window.App.accounts,
                currentId: window.App.currentId,
                posts: window.App.posts,
                aiConfig: window.App.aiConfig,
                activeAIId: window.App.activeAIId,
                randomAIMode: window.App.randomAIMode,
                exportedAt: Date.now(),
                mediaStats: { images: imgCount, videos: vidCount }
            };

            var statsText = [
                "导出时间：" + new Date().toLocaleString(),
                "图片数量：" + imgCount,
                "视频数量：" + vidCount,
                "账号数量：" + (window.App.accounts || []).length,
                "动态数量：" + (window.App.posts || []).length
            ].join("\n");

            if (typeof JSZip !== "undefined") {
                var zip = new JSZip();
                zip.file("data.json", JSON.stringify(data, null, 2));
                zip.file("media_stats.txt", statsText);

                if (allMediaIds.length > 0) {
                    var mediaFolder = zip.folder("media");
                    for (var i = 0; i < allMediaIds.length; i++) {
                        var mid = allMediaIds[i];
                        var blob = null;
                        var isVideo = (window.App.posts || []).some(function (p) {
                            return (p.videos || []).indexOf(mid) !== -1;
                        });
                        var ext = isVideo ? ".mp4" : ".jpg";

                        try { var rec = await window.App.getMedia(mid); if (rec && rec.blob) blob = rec.blob; } catch (e) { }
                        if (!blob && window._fbDownloadMedia) { try { blob = await window._fbDownloadMedia(mid); } catch (e) { } }
                        if (!blob) { try { var u = await window.App.loadMediaUrl(mid); if (u) { var r = await fetch(u); if (r.ok) blob = await r.blob(); } } catch (e) { } }

                        if (blob) mediaFolder.file(mid + ext, blob);
                    }
                }

                var zipBlob = await zip.generateAsync({ type: "blob" });
                var url = URL.createObjectURL(zipBlob);
                var a = document.createElement("a");
                a.href = url;
                a.download = "moments-backup-" + new Date().toISOString().slice(0, 10) + ".zip";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                var json = JSON.stringify(data, null, 2);
                var outBlob = new Blob([json], { type: "application/json" });
                var url = URL.createObjectURL(outBlob);
                var a = document.createElement("a");
                a.href = url;
                a.download = "moments-backup-" + new Date().toISOString().slice(0, 10) + ".json";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            showExportSuccessModal(imgCount, vidCount);
        } catch (e) {
            console.error("导出失败:", e);
            window.App.showToast("导出失败");
        }
    }

    function showExportSuccessModal(imgCount, vidCount) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        var mediaPart = "";
        if (imgCount > 0 || vidCount > 0) {
            mediaPart = '<p style="color:var(--accent);text-align:center;font-size:13px;margin:8px 0;">\u8bf7\u89e3\u538b\u540e\u624b\u52a8\u68c0\u67e5 media \u6587\u4ef6\u5939\u4e2d\u7684\u591a\u5a92\u4f53\u6587\u4ef6\u662f\u5426\u5b8c\u6574</p>';
        }
        overlay.innerHTML = '<div class="modal-dialog">' +
            '<h3>\u5bfc\u51fa\u6210\u529f</h3>' +
            '<p style="text-align:center;font-size:15px;margin:12px 0;color:var(--text);">\u56fe\u7247 ' + imgCount + ' \u5f20\u3000\u89c6\u9891 ' + vidCount + ' \u4e2a</p>' +
            mediaPart +
            '<div class="btn-row" style="justify-content:center;margin-top:16px;">' +
            '<button class="btn btn-save" id="exportOkBtn">\u6211\u77e5\u9053\u4e86</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#exportOkBtn').onclick = function () { overlay.remove(); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    }

    // === 数据导入 ===
    async function importData(file) {
        console.log("[导入] 开始, file:", file.name, file.size, "bytes");
        window.App.showProgress("正在读取...");
        try {
            function toArray(v) { if (!v) return []; if (Array.isArray(v)) return v; return Object.values(v); }
            function fixPost(p) { if (!p) return p; p.likes = toArray(p.likes); p.comments = toArray(p.comments); p.images = toArray(p.images); p.videos = toArray(p.videos); return p; }

            var data;
            var mediaFilesForImport = [];

            if (file.name.endsWith(".zip") && typeof JSZip !== "undefined") {
                var zip = await JSZip.loadAsync(file);
                var dataFile = zip.file("data.json");
                if (!dataFile) { window.App.hideProgress(); window.App.showToast("无效的备份文件"); return; }
                var jsonText = await dataFile.async("text");
                data = JSON.parse(jsonText);

                var mediaFolder = zip.folder("media");
                if (mediaFolder) {
                    var mediaFiles = Object.keys(zip.files).filter(function (n) { return n.indexOf("media/") === 0; });
                    for (var i = 0; i < mediaFiles.length; i++) {
                        try {
                            var fe = zip.file(mediaFiles[i]);
                            if (fe) {
                                var fb = await fe.async("blob");
                                var mid = mediaFiles[i].replace("media/", "").replace(/\.[^.\/]+$/, "");
                                var type = mediaFiles[i].slice(-4) === ".mp4" ? "video" : "image";
                                mediaFilesForImport.push({ mid: mid, blob: fb, type: type });
                            }
                        } catch (e) { }
                    }
                }
            } else {
                var text = await new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function (e) { resolve(e.target.result); };
                    reader.onerror = function () { reject(new Error("read failed")); };
                    reader.readAsText(file);
                });
                data = JSON.parse(text);
            }

            if (!data.accounts || !data.posts) {
                window.App.hideProgress();
                window.App.showToast("备份文件数据不完整");
                return;
            }

            data.accounts = toArray(data.accounts);
            data.posts = toArray(data.posts).map(fixPost);
            data.currentId = data.currentId || "";

            window.App.hideProgress();

            var imgCount = 0, vidCount = 0;
            data.posts.forEach(function (p) {
                imgCount += (p.images || []).length;
                vidCount += (p.videos || []).length;
            });

            console.log("[导入] 解析成功, accounts:", data.accounts.length, "posts:", data.posts.length, "media:", mediaFilesForImport.length);
            showImportModeModal(data, mediaFilesForImport, imgCount, vidCount);
        } catch (e) {
            window.App.hideProgress();
            console.error("导入失败:", e);
            window.App.showToast("导入失败，请检查文件格式");
        }
    }

    function showImportModeModal(data, mediaFiles, imgCount, vidCount) {
        var overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.innerHTML = "<div class=\"modal-dialog\">" +
            "<h3>导入数据</h3>" +
            "<p style=\"text-align:center;font-size:14px;margin:8px 0;color:var(--text);\">账号 " + data.accounts.length + " 个  动态 " + data.posts.length + " 个</p>" +
            "<p style=\"text-align:center;font-size:14px;margin:4px 0 12px;color:var(--text);\">图片 " + imgCount + " 张  视频 " + vidCount + " 个</p>" +
            "<p style=\"text-align:center;font-size:12px;color:var(--text-light);margin-bottom:16px;\">请选择导入方式</p>" +
            "<div class=\"btn-row\" style=\"justify-content:center;gap:12px;\">" +
            "<button class=\"btn btn-cancel\" id=\"importReplaceBtn\">替换现有数据</button>" +
            "<button class=\"btn btn-save\" id=\"importMergeBtn\">合并到现有数据</button>" +
            "</div>" +
            "<p style=\"text-align:center;font-size:11px;color:var(--text-light);margin-top:10px;\">替换将清空当前所有数据；合并会以ID去重，仅添加新内容</p>" +
            "</div>";
        document.body.appendChild(overlay);

        overlay.querySelector("#importReplaceBtn").onclick = async function () {
            console.log("[导入-UI] 用户选择了: 替换");
            overlay.remove();
            await applyImportedData(data, mediaFiles, "replace");
        };
        overlay.querySelector("#importMergeBtn").onclick = async function () {
            console.log("[导入-UI] 用户选择了: 合并");
            overlay.remove();
            await applyImportedData(data, mediaFiles, "merge");
        };
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    }

    async function applyImportedData(data, mediaFiles, mode) {
        console.log("[导入-应用] mode:", mode, "accounts:", data.accounts.length, "posts:", data.posts.length, "media:", mediaFiles.length);
        window.App.showProgress("正在应用...");

        if (mode === "merge") {
            var existingAccIds = window.App.accounts.map(function (a) { return a.id; });
            var existingPostIds = window.App.posts.map(function (p) { return p.id; });

            data.accounts.forEach(function (a) {
                if (existingAccIds.indexOf(a.id) === -1) window.App.accounts.push(a);
            });
            data.posts.forEach(function (p) {
                if (existingPostIds.indexOf(p.id) === -1) window.App.posts.push(p);
            });
        } else {
            window.App.accounts = data.accounts;
            window.App.posts = data.posts;
        }

        window.App.currentId = data.currentId || window.App.accounts[0]?.id || "";
        if (data.aiConfig && Object.keys(data.aiConfig).length > 0) window.App.aiConfig = data.aiConfig;
        window.App.activeAIId = data.activeAIId || null;
        window.App.randomAIMode = !!data.randomAIMode;

        await window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
        await window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);
        localStorage.setItem(window.App.KEY_CUR, window.App.currentId);
        if (window.App.aiConfig && Object.keys(window.App.aiConfig).length) { window.App.saveAIConfig(); }
        if (window.App.activeAIId) { localStorage.setItem(window.App.KEY_ACTIVE_AI, window.App.activeAIId); }
        else { localStorage.removeItem(window.App.KEY_ACTIVE_AI); }
        localStorage.setItem(window.App.KEY_RANDOM_AI, window.App.randomAIMode ? "true" : "false");

        for (var k = 0; k < mediaFiles.length; k++) {
            try {
                await window.App.saveMedia(mediaFiles[k].mid, mediaFiles[k].blob, mediaFiles[k].type);
            } catch (e) { }
        }

        // 导入属于用户主动操作 → 标记脏数据 + 强制上传（跳过时间戳比对）
        markLocalDirty();
        console.log("[导入-应用] 同步到Firebase（强制上传）...");
        if (window._fbSyncImmediate) {
            try {
                var ts = await window._fbSyncImmediate(window.App.accounts, window.App.posts);
                if (ts) {
                    _localDataTs = ts;
                    localStorage.setItem('_localDataTs', String(ts));
                }
                console.log("[导入-应用] Firebase同步完成");
            } catch (e) {
                console.error("[导入-应用] Firebase同步失败:", e);
            }
        } else {
            console.warn("[导入-应用] _fbSyncImmediate 不可用，跳过Firebase同步");
        }

        window.App.hideProgress();

        var imgCount = 0, vidCount = 0;
        window.App.posts.forEach(function (p) {
            imgCount += (p.images || []).length;
            vidCount += (p.videos || []).length;
        });

        var label = mode === "merge" ? "合并完成" : "替换完成";
        showImportDoneModal(label, imgCount, vidCount);
    }

    function showImportDoneModal(label, imgCount, vidCount) {
        var overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.innerHTML = "<div class=\"modal-dialog\">" +
            "<h3>" + label + "</h3>" +
            "<p style=\"text-align:center;font-size:15px;margin:12px 0;color:var(--text);\">图片 " + imgCount + " 张  视频 " + vidCount + " 个</p>" +
            "<p style=\"color:var(--accent);text-align:center;font-size:13px;margin:8px 0;\">点击确认后页面将刷新以加载新数据</p>" +
            "<div class=\"btn-row\" style=\"justify-content:center;margin-top:16px;\">" +
            "<button class=\"btn btn-save\" id=\"importDoneBtn\">确认并刷新</button>" +
            "</div></div>";
        document.body.appendChild(overlay);
        overlay.querySelector("#importDoneBtn").onclick = function () { location.reload(); };
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    }

    // === 分享动态 ===
    function sharePost(id) {
        var post = (window.App.posts || []).find(function (p) { return p.id === id; });
        if (!post) return;
        var author = window.App.getAcc(post.userId) || { nickname: '未知' };

        var shared = {
            postId: post.id,
            text: post.text || '',
            timestamp: post.timestamp,
            images: post.images || [],
            videos: post.videos || [],
            author: {
                nickname: author.nickname,
                isAI: !!author.isAI
            },
            likes: post.likes.map(function (uid) {
                var u = window.App.getAcc(uid) || { nickname: '未知' };
                return { nickname: u.nickname, isAI: !!u.isAI };
            }),
            comments: post.comments.map(function (c) {
                var cu = window.App.getAcc(c.userId) || { nickname: '未知' };
                return {
                    text: c.text,
                    timestamp: c.timestamp,
                    user: { nickname: cu.nickname, isAI: !!cu.isAI }
                };
            })
        };

        var jsonStr = JSON.stringify(shared, null, 2);
        var blob = new Blob([jsonStr], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'post-' + post.id + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        window.App.showToast('📤 帖子已导出');
    }

    function copyPost(id) {
        var post = (window.App.posts || []).find(function (p) { return p.id === id; });
        if (!post) return;
        var author = window.App.getAcc(post.userId) || { nickname: '未知' };

        var lines = [];
        lines.push('**' + author.nickname + '**');
        lines.push(post.text || '');
        if (post.images && post.images.length) {
            post.images.forEach(function (img) {
                if (img.startsWith('data:')) {
                    lines.push('![图片](' + img.substring(0, 50) + '...)');
                } else {
                    lines.push('![图片](' + img + ')');
                }
            });
        }

        var text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                window.App.showToast('📋 帖子已复制');
            }).catch(function () {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function copyComment(postId, commentId) {
        var post = (window.App.posts || []).find(function (p) { return p.id === postId; });
        if (!post) return;
        var comment = (post.comments || []).find(function (c) { return c.id === commentId; });
        if (!comment) return;
        var cu = window.App.getAcc(comment.userId) || { nickname: '未知' };

        var text = cu.nickname + '：' + (comment.text || '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                window.App.showToast('📋 评论已复制');
            }).catch(function () {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(t) {
        var ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        window.App.showToast('📋 已复制到剪贴板');
    }

    function exportBackup() {
        exportData();
    }

    // ─────────────────────────────────────────────
    // 强制从云端拉取（设置菜单选项）
    // ─────────────────────────────────────────────
    async function forceLoadFromCloud() {
        if (!window._fbForceLoad) {
            window.App.showToast('☁️ 云端功能未就绪');
            return;
        }
        window.App.showProgress('正在从云端拉取...');
        try {
            var cloudData = await window._fbForceLoad();
            if (!cloudData || !cloudData.accounts) {
                window.App.hideProgress();
                window.App.showToast('☁️ 云端暂无数据');
                return;
            }

            function toArray(v) { if (!v) return []; if (Array.isArray(v)) return v; return Object.values(v); }
            function fixPost(p) { if (!p) return p; p.likes = toArray(p.likes); p.comments = toArray(p.comments); p.images = toArray(p.images); p.videos = toArray(p.videos); return p; }

            window.App.accounts = toArray(cloudData.accounts);
            window.App.posts = toArray(cloudData.posts || []).map(fixPost);

            // 加载云端 AI 配置（手动强制拉取，不自动上传）
            if (cloudData.aiConfig && typeof cloudData.aiConfig === 'object') {
                window.App.aiConfig = cloudData.aiConfig;
                window.App.saveAIConfig();
            }

            await window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
            await window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);

            // 将本地时间戳对齐为云端时间戳，避免下次误判为本地更新
            var cloudTs = cloudData._cloudTs || Date.now();
            _localDataTs = cloudTs;
            localStorage.setItem('_localDataTs', String(cloudTs));

            window.App.hideProgress();
            renderUI();
            window.App.showToast('✅ 已强制从云端拉取最新数据');
        } catch (e) {
            window.App.hideProgress();
            console.error('强制拉取失败:', e);
            window.App.showToast('❌ 拉取失败，请检查网络');
        }
    }

    // ─────────────────────────────────────────────
    // 手动上传到云端（设置菜单 / 用户明确触发）
    // ─────────────────────────────────────────────
    async function manualUploadToCloud() {
        window.App.showProgress('正在上传到云端...');
        try {
            markLocalDirty(); // 手动触发时强制刷新时间戳
            var result = await uploadToCloud(true); // force=true 跳过时间戳比对
            window.App.hideProgress();
            if (result && result.error) {
                window.App.showToast('❌ 上传失败，请检查网络');
            } else {
                window.App.showToast('✅ 数据已上传到云端');
            }
        } catch (e) {
            window.App.hideProgress();
            window.App.showToast('❌ 上传失败');
        }
    }

    // --- 初始化时立即绑定事件 ---
    function bindAllEvents() {
        // 普通账号下拉按钮
        var headerUserArea = $('#headerUserArea');
        if (headerUserArea) {
            headerUserArea.onclick = function (e) {
                e.stopPropagation();
                var $normalDropdown = $('#normalDropdown');
                if (!$normalDropdown) return;
                var isOpen = $normalDropdown.style.display === 'block';
                window.App.closeAllDropdowns();
                if (!isOpen) {
                    var rect = e.currentTarget.getBoundingClientRect();
                    $normalDropdown.style.top = (rect.bottom + 4) + 'px';
                    $normalDropdown.style.left = rect.left + 'px';
                    $normalDropdown.style.display = 'block';
                    window.App.renderNormalDropdown();
                }
            };
        }

        var $normalDropdown = $('#normalDropdown');
        if ($normalDropdown) {
            $normalDropdown.onclick = function (e) {
                e.stopPropagation();
                if (e.target.dataset.action === 'edit') {
                    window.App.editAccount(e.target.dataset.accountId);
                    return;
                }
                var item = e.target.closest ? e.target.closest('.account-dropdown-item') : null;
                if (item && item.dataset.accountId) {
                    window.App.switchAccount(item.dataset.accountId);
                }
                if (e.target.id === 'btnAddAccount' || (e.target.closest && e.target.closest('#btnAddAccount'))) {
                    window.App.addAccount();
                }
            };
        }

        var headerAIArea = $('#headerAIArea');
        if (headerAIArea) {
            headerAIArea.onclick = function (e) {
                e.stopPropagation();
                var $aiDropdown = $('#aiDropdown');
                if (!$aiDropdown) return;
                var isOpen = $aiDropdown.style.display === 'block';
                window.App.closeAllDropdowns();
                if (!isOpen) {
                    var rect = e.currentTarget.getBoundingClientRect();
                    var dropdownWidth = $aiDropdown.offsetWidth || 220;
                    $aiDropdown.style.top = (rect.bottom + 4) + 'px';
                    $aiDropdown.style.left = (rect.left + rect.width / 2 - dropdownWidth / 2) + 'px';
                    $aiDropdown.style.display = 'block';
                    window.App.renderAIDropdown();
                }
            };
        }

        var $aiDropdown = $('#aiDropdown');
        if ($aiDropdown) {
            $aiDropdown.onclick = function (e) { e.stopPropagation(); };
        }

        var btnMoreMenu = $('#btnMoreMenu');
        if (btnMoreMenu) {
            btnMoreMenu.onclick = function (e) {
                e.stopPropagation();
                var $settingsDropdown = $('#settingsDropdown');
                if (!$settingsDropdown) return;
                var isOpen = $settingsDropdown.style.display === 'block';
                window.App.closeAllDropdowns();
                if (!isOpen) {
                    $settingsDropdown.style.display = 'block';
                    var isDark = document.body.classList.contains('dark-mode');
                    var themeItem = $('#settingsThemeItem');
                    if (themeItem) themeItem.textContent = isDark ? '☀️ 切换日间模式' : '🌙 切换夜间模式';
                }
            };
        }

        var $settingsDropdown = $('#settingsDropdown');
        if ($settingsDropdown) {
            $settingsDropdown.onclick = function (e) {
                e.stopPropagation();
                var item = e.target.closest ? e.target.closest('.settings-dropdown-item') : null;
                if (!item) return;
                var action = item.dataset.action;
                $settingsDropdown.style.display = 'none';

                switch (action) {
                    case 'toggle-theme':
                        document.body.classList.toggle('dark-mode');
                        var dark = document.body.classList.contains('dark-mode');
                        localStorage.setItem(window.App.KEY_THEME, dark ? 'dark' : 'light');
                        window.App.showToast(dark ? '🌙 已切换夜间模式' : '☀️ 已切换日间模式');
                        break;
                    case 'search':
                        toggleSearch();
                        break;
                    case 'ai-settings':
                        window.App.openAISettings();
                        break;
                    case 'ai-post':
                        window.App.openAIPostModal();
                        break;
                    case 'export':
                        exportData();
                        break;
                    case 'import':
                        var inp = document.createElement('input');
                        inp.type = 'file';
                        inp.accept = '.zip,.json';
                        inp.onchange = function () { if (inp.files[0]) importData(inp.files[0]); };
                        inp.click();
                        break;
                    case 'refresh':
                        window.App.clearMediaCache();
                        window.App.refreshAll().then(function () { window.App.showToast('🔄 已刷新'); });
                        break;
                    case 'upload-cloud':
                        manualUploadToCloud();
                        break;
                    case 'force-pull-cloud':
                        forceLoadFromCloud();
                        break;
                    case 'about':
                        window.location.href = 'about.html';
                        break;    
                }
            };
        }

        var $btnPublish = $('#btnPublish');
        if ($btnPublish) $btnPublish.onclick = window.App.publish;

        var $btnCancelEdit = $('#btnCancelEdit');
        if ($btnCancelEdit) $btnCancelEdit.onclick = function () { if (window.App.cancelEdit) window.App.cancelEdit(); };

        var $publishText = $('#publishText');
        if ($publishText) $publishText.oninput = window.App.updatePublishBtn;

        var btnAddImage = $('#btnAddImage');
        if (btnAddImage) btnAddImage.onclick = function () { var inp = $('#imageInput'); if (inp) inp.click(); };

        var btnAddVideo = $('#btnAddVideo');
        if (btnAddVideo) btnAddVideo.onclick = function () { var inp = $('#videoInput'); if (inp) inp.click(); };

        var btnAddEmoji = $('#btnAddEmoji');
        if (btnAddEmoji) {
            btnAddEmoji.onclick = function () {
                var emojis = ['😀', '😂', '😍', '🥰', '😎', '🤩', '😇', '🤗', '😋', '😜', '🤔', '😌', '😴', '🥳', '👍',
                    '👏', '🙌', '💪', '🎉', '🌟', '🔥', '💖', '🤣', '🥺', '😭', '😱', '😏', '🫡', '🥱', '😈',
                    '👻', '💀', '👋', '🤝', '👌', '🤏', '✌️', '🤞', '🫰', '👊', '🙏', '💯', '✨', '💥',
                    '🌈', '💦', '💤', '🍉', '🍓', '🍒', '🌸', '🌺', '🌙', '⚡', '❤️',
                    '😅', '😆', '🙂', '🙃', '😉', '🥴', '😵', '🤯', '🤢', '🤧', '🤒', '🤕', '😷', '👿',
                    '🤡', '👹', '👺', '💩', '🙈', '🙉', '🙊', '💋', '👄', '👅', '👁️', '🫀', '💓', '💔',
                    '💘', '💝', '💞', '🩷', '🤎', '🤍', '⭐', '🌠', '🌪️', '☄️', '🎊', '🎁', '🎈', '🎀',
                    '🎐', '🎏', '🍭', '🍬', '🍫', '🍩', '🍰', '🧁', '🍦', '🍧', '🍿', '🥤', '🧃', '🍼'];
                var emoji = emojis[Math.floor(Math.random() * emojis.length)];
                var $pt = $('#publishText');
                if (!$pt) return;
                var s = $pt.selectionStart, e2 = $pt.selectionEnd;
                $pt.value = $pt.value.slice(0, s) + emoji + $pt.value.slice(e2);
                $pt.selectionStart = $pt.selectionEnd = s + emoji.length;
                $pt.focus();
                window.App.updatePublishBtn();
            };
        }

        var btnSchedule = $('#btnSchedule');
        if (btnSchedule) {
            btnSchedule.onclick = function () {
                var timeInput = $('#scheduleTime');
                if (!timeInput) return;
                timeInput.style.display = timeInput.style.display === 'inline-block' ? 'none' : 'inline-block';
            };
        }

        var btnQuality = $('#btnQuality');
        if (btnQuality) {
            btnQuality.onclick = function (e) {
                e.stopPropagation();
                var $qualitySelector = $('#qualitySelector');
                if (!$qualitySelector) return;
                $qualitySelector.style.display = $qualitySelector.style.display === 'block' ? 'none' : 'block';
            };
        }

        var imageInput = $('#imageInput');
        if (imageInput) {
            imageInput.onchange = function () {
                for (var i = 0; i < this.files.length; i++) {
                    if (window.App.publishFiles.filter(function (m) { return m.type === 'image'; }).length >= 9) {
                        window.App.showToast('最多9张图片'); break;
                    }
                    window.App.publishFiles.push({ type: 'image', file: this.files[i], previewUrl: URL.createObjectURL(this.files[i]) });
                }
                window.App.renderPublishPreview();
                window.App.updatePublishBtn();
                this.value = '';
            };
        }

        var videoInput = $('#videoInput');
        if (videoInput) {
            videoInput.onchange = function () {
                var f = this.files[0]; if (!f) return;
                if (window.App.publishFiles.some(function (m) { return m.type === 'video'; })) {
                    window.App.showToast('已有视频'); return;
                }
                window.App.publishFiles.push({ type: 'video', file: f, previewUrl: URL.createObjectURL(f) });
                window.App.renderPublishPreview();
                window.App.updatePublishBtn();
                this.value = '';
            };
        }

        var imageModalClose = $('#imageModalClose');
        if (imageModalClose) imageModalClose.onclick = window.App.closeImageModal;

        var imageModal = $('#imageModal');
        if (imageModal) {
            imageModal.onclick = function (e) { if (e.target === imageModal) window.App.closeImageModal(); };
        }

        var imageModalPrev = $('#imageModalPrev');
        if (imageModalPrev) imageModalPrev.onclick = function () { window.App.navImage(-1); };
        var imageModalNext = $('#imageModalNext');
        if (imageModalNext) imageModalNext.onclick = function () { window.App.navImage(1); };

        var btnBackToTop = $('#btnBackToTop');
        if (btnBackToTop) btnBackToTop.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };

        var $searchInput = $('#searchInput');
        if ($searchInput) {
            $searchInput.addEventListener('input', function () {
                if (searchActive) window.App.renderSearchResults($searchInput.value);
            });
        }

        var btnClearSearch = $('#btnClearSearch');
        if (btnClearSearch) {
            btnClearSearch.onclick = function () {
                var $searchBar = $('#searchBar');
                if (!$searchBar || !$searchInput) return;
                searchActive = false;
                window.App.searchActive = false;
                $searchBar.style.display = 'none';
                var header = document.querySelector('.header');
                if (header) header.classList.remove('search-active');
                $searchInput.value = '';
                window.App.renderTimeline(true);
            };
        }

        var aiSettingsCancel = $('#aiSettingsCancel');
        if (aiSettingsCancel) aiSettingsCancel.onclick = function () { var m = $('#aiSettingsModal'); if (m) m.style.display = 'none'; };

        // 手动上传 AI 配置到云端
        var aiSettingsUploadCloud = $('#aiSettingsUploadCloud');
        if (aiSettingsUploadCloud) {
            aiSettingsUploadCloud.onclick = async function () {
                if (!window._fbUploadAIConfig) {
                    window.App.showToast('☁️ 云端功能未就绪');
                    return;
                }
                // 先用当前表单值更新 aiConfig
                window.App.aiConfig = {
                    endpoint: ($('#aiEndpoint') || {}).value || '',
                    apiKey: ($('#aiApiKey') || {}).value || '',
                    model: ($('#aiModel') || {}).value || '',
                    timeout: parseInt(($('#aiTimeout') || {}).value) || 15
                };
                window.App.saveAIConfig();
                $('#aiSettingsUploadCloud').disabled = true;
                $('#aiSettingsUploadCloud').textContent = '⏳ 上传中...';
                var ok = await window._fbUploadAIConfig(window.App.aiConfig);
                $('#aiSettingsUploadCloud').disabled = false;
                $('#aiSettingsUploadCloud').textContent = '☁️ 上传到云端';
                window.App.showToast(ok ? '✅ AI配置已上传到云端' : '❌ 上传失败');
            };
        }

        // 手动从云端拉取 AI 配置
        var aiSettingsPullCloud = $('#aiSettingsPullCloud');
        if (aiSettingsPullCloud) {
            aiSettingsPullCloud.onclick = async function () {
                if (!window._fbPullAIConfig) {
                    window.App.showToast('☁️ 云端功能未就绪');
                    return;
                }
                $('#aiSettingsPullCloud').disabled = true;
                $('#aiSettingsPullCloud').textContent = '⏳ 拉取中...';
                var cloudCfg = await window._fbPullAIConfig();
                $('#aiSettingsPullCloud').disabled = false;
                $('#aiSettingsPullCloud').textContent = '⬇️ 从云端拉取';
                if (cloudCfg && typeof cloudCfg === 'object') {
                    window.App.aiConfig = cloudCfg;
                    window.App.saveAIConfig();
                    // 回填表单
                    var ep = $('#aiEndpoint'); if (ep) ep.value = cloudCfg.endpoint || '';
                    var ak = $('#aiApiKey'); if (ak) ak.value = cloudCfg.apiKey || '';
                    var md = $('#aiModel'); if (md) md.value = cloudCfg.model || '';
                    var to = $('#aiTimeout'); if (to) to.value = cloudCfg.timeout || 15;
                    window.App.showToast('✅ AI配置已从云端拉取');
                } else {
                    window.App.showToast('☁️ 云端暂无AI配置');
                }
            };
        }

        var aiSettingsSave = $('#aiSettingsSave');
        if (aiSettingsSave) {
            aiSettingsSave.onclick = function () {
                window.App.aiConfig = {
                    endpoint: ($('#aiEndpoint') || {}).value || '',
                    apiKey: ($('#aiApiKey') || {}).value || '',
                    model: ($('#aiModel') || {}).value || '',
                    timeout: parseInt(($('#aiTimeout') || {}).value) || 15
                };
                window.App.saveAIConfig();
                var m = $('#aiSettingsModal'); if (m) m.style.display = 'none';
                window.App.showToast('✅ AI 设置已保存');
            };
        }

        var aiSettingsModal = $('#aiSettingsModal');
        if (aiSettingsModal) {
            aiSettingsModal.addEventListener('click', function (e) {
                if (e.target === aiSettingsModal) aiSettingsModal.style.display = 'none';
            });
        }
    }

    document.addEventListener('click', function (e) {
        var menus = document.querySelectorAll('.post-menu-dropdown');
        for (var i = 0; i < menus.length; i++) { menus[i].style.display = 'none'; }
        window.App.closeAllDropdowns();
        var $qualitySelector = $('#qualitySelector');
        if ($qualitySelector && $qualitySelector.style.display === 'block') {
            var $btnQ = $('#btnQuality');
            if ($btnQ && !$btnQ.contains(e.target) && !$qualitySelector.contains(e.target)) {
                $qualitySelector.style.display = 'none';
            }
        }
    });

    document.addEventListener('keydown', function (e) {
        var imageModal = $('#imageModal');
        if (window.App.modalData && imageModal && imageModal.style.display === 'flex') {
            if (e.key === 'Escape') window.App.closeImageModal();
            if (e.key === 'ArrowLeft') window.App.navImage(-1);
            if (e.key === 'ArrowRight') window.App.navImage(1);
        }
    });

    window.addEventListener('scroll', function () {
        if (window.App.searchActive) return;
        var posts = window.App.posts || [];
        var renderedCount = window.App.renderedCount || 0;
        if (renderedCount >= posts.length) return;
        var scrollBottom = window.scrollY + window.innerHeight;
        if (scrollBottom >= document.body.offsetHeight - 150) {
            var loader = document.querySelector('#loaderIndicator');
            if (loader) loader.style.display = 'block';
            setTimeout(function () { window.App.renderTimeline(false); }, 200);
        }
    }, { passive: true });

    var theme = localStorage.getItem(window.App.KEY_THEME);
    if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (theme === 'dark') {
        if (document.body) {
            document.body.classList.add('dark-mode');
        } else {
            // body还没好，等它好了再加
            document.addEventListener('DOMContentLoaded', function () {
                document.body.classList.add('dark-mode');
            });
        }
    }

    async function refreshAll() {
        try {
            window.App.accounts = (await window.App.getAppData(window.App.KEY_ACC)) || [];
            window.App.currentId = localStorage.getItem(window.App.KEY_CUR);
            window.App.posts = (await window.App.getAppData(window.App.KEY_POSTS)) || [];
            window.App.aiConfig = window.App.getJSON(window.App.KEY_AI) || {};
        } catch (e) { }
        renderUI();
    }

    function renderUI() {
        try { window.App.renderHeader(); } catch (e) { }
        try { window.App.renderNormalDropdown(); } catch (e) { }
        try { window.App.renderAIDropdown(); } catch (e) { }
        try { window.App.renderTimeline(true); } catch (e) { }
        try { window.App.updatePublishBtn(); } catch (e) { }
    }

    async function init() {
        bindAllEvents();
        document.addEventListener('keydown', function (e) {
            const publishText = $('#publishText');
            if (publishText && document.activeElement === publishText) {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.isComposing) {
                    e.preventDefault();
                    window.App.publish();
                    return;
                }
            }
            if (e.target && e.target.matches && e.target.matches('input[id^="commentInput-"]')) {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.isComposing) {
                    e.preventDefault();
                    const postId = e.target.id.replace('commentInput-', '');
                    window.App.submitComment(postId);
                }
            }
        });
        // 图片链接悬停预览
        let hoverTimeout = null;
        const previewTooltip = document.getElementById('imagePreviewTooltip');
        const previewImg = document.getElementById('imagePreviewImg');

        // 检测链接是否为图片
        function isImageUrl(url) {
            if (!url) return false;
            const lower = url.toLowerCase();
            return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(lower) ||
                /^data:image\//i.test(lower);
        }

        // 鼠标进入链接
        $('#timeline').addEventListener('mouseover', function (e) {
            const link = e.target.closest('a');
            if (!link || !isImageUrl(link.href)) return;

            // 忽略已经被渲染为图片的链接（Markdown图片语法会生成 img 子元素）
            if (link.querySelector('img')) return;

            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                previewImg.src = link.href;
                previewTooltip.style.display = 'block';
                // 定位在鼠标位置右下角
                previewTooltip.style.left = (e.clientX + 10) + 'px';
                previewTooltip.style.top = (e.clientY + 10) + 'px';
            }, 200); // 轻微延迟，避免快速划过时闪烁
        });

        // 鼠标移出链接
        $('#timeline').addEventListener('mouseout', function (e) {
            const link = e.target.closest('a');
            if (!link || !isImageUrl(link.href)) return;
            clearTimeout(hoverTimeout);
            previewTooltip.style.display = 'none';
        });

        $('#timeline').addEventListener('mousemove', function (e) {
            if (previewTooltip.style.display === 'block') {
                previewTooltip.style.left = (e.clientX + 10) + 'px';
                previewTooltip.style.top = (e.clientY + 10) + 'px';
            }
        });
        try { await loadDataAndRender(); } catch (e) {
            console.error('初始化失败:', e);
            renderUI();
            window.App.showToast('⚠️ 加载数据失败，请刷新页面');
        }
    }

    function toArray(v) { if (!v) return []; if (Array.isArray(v)) return v; return Object.values(v); }
    function fixPost(p) { if (!p) return p; p.likes = toArray(p.likes); p.comments = toArray(p.comments); p.images = toArray(p.images); p.videos = toArray(p.videos); return p; }

    // ─────────────────────────────────────────────
    // 初始化数据加载：云端优先，本地仅做缓存回退
    // ─────────────────────────────────────────────
    async function loadDataAndRender() {
        // Step 1: 先用本地缓存快速渲染，给用户即时反馈
        try {
            var lsAccounts = window.App.getJSON(window.App.KEY_ACC) || [];
            var lsPosts = window.App.getJSON(window.App.KEY_POSTS) || [];

            try {
                var accData = await window.App.getAppData(window.App.KEY_ACC);
                window.App.accounts = (accData && accData.length) ? accData : (lsAccounts.length ? lsAccounts : []);
                var postData = await window.App.getAppData(window.App.KEY_POSTS);
                window.App.posts = (postData && postData.length) ? postData : (lsPosts.length ? lsPosts : []);
            } catch (dbErr) {
                window.App.accounts = lsAccounts.length ? lsAccounts : [];
                window.App.posts = lsPosts.length ? lsPosts : [];
            }

            if (!window.App.accounts || !window.App.accounts.length || !window.App.accounts.some(function (a) { return !a.isAI; })) {
                window.App.accounts = window.App.accounts || [];
                window.App.accounts.push(
                    { id: 'acc_' + Date.now(), nickname: '我', avatar: '', avatarText: '', avatarBg: '#3498db', badgeText: '我', badgeColor: '#3498db', createdAt: Date.now() },
                    { id: 'acc_' + (Date.now() + 1), nickname: '小明', avatar: '', avatarText: '', avatarBg: '#f5af19', badgeText: '好朋友', badgeColor: '#f39c12', createdAt: Date.now() }
                );
                // ⚠️ 初始化阶段只存本地，不触发云端上传
                // 云端数据还未拉取，此时上传会用空数据覆盖云端
                window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
            }

            if (!window.App.currentId || !window.App.accounts.find(function (a) { return a.id === window.App.currentId; })) {
                var firstNormal = window.App.accounts.find(function (a) { return !a.isAI; });
                window.App.currentId = firstNormal ? firstNormal.id : window.App.accounts[0].id;
                localStorage.setItem(window.App.KEY_CUR, window.App.currentId);
            }

            try {
                await window.App.restoreBackupIfNewer();
            } catch (backupErr) { }
        } catch (e) { console.error('本地数据加载失败:', e); }

        // Step 2: 先渲染本地数据（用户立即看到内容）
        renderUI();

        // Step 3: 异步加载云端数据（云端优先，拉下来覆盖本地）
        loadFirebaseInBackground();

        window.debug = { clearMediaCache: window.App.clearMediaCache, refreshAll: refreshAll, openDB: window.App.openDB, getMedia: window.App.getMedia, posts: window.App.posts };
    }

    // ─────────────────────────────────────────────
    // Firebase 后台加载：云端数据优先，单向拉取
    // 不自动上传，只接收云端推送
    // ─────────────────────────────────────────────
    async function loadFirebaseInBackground() {
        var lastSyncTs = 0;
        window._onLocalSync = function () { lastSyncTs = Date.now(); };
        var initDone = false;
        setTimeout(function () { initDone = true; }, 4000);

        try {
            if (window.App._fbReadyPromise) {
                await Promise.race([
                    window.App._fbReadyPromise,
                    new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 3000); })
                ]);

                // ── 云端优先：直接拉取云端数据覆盖本地 ──
                if (window._fbLoadData) {
                    var cloudData = await window._fbLoadData();
                    if (cloudData && cloudData.accounts) {
                        cloudData.accounts = toArray(cloudData.accounts);
                        cloudData.posts = toArray(cloudData.posts || []).map(fixPost);

                        if (cloudData.accounts.length) {
                            // 将本地时间戳对齐为云端时间戳，后续上传时才能正确比对
                            var cloudTs = (cloudData._meta && cloudData._meta.updatedAt) ? cloudData._meta.updatedAt : 0;
                            if (cloudTs > 0 && cloudTs > _localDataTs) {
                                _localDataTs = cloudTs;
                                localStorage.setItem('_localDataTs', String(cloudTs));
                            }

                            window.App.accounts = cloudData.accounts;
                            window.App.posts = cloudData.posts;
                            // 加载云端 AI 配置（仅初始加载，不自动上传）
                            if (cloudData.aiConfig && typeof cloudData.aiConfig === 'object') {
                                window.App.aiConfig = cloudData.aiConfig;
                                window.App.saveAIConfig();
                            }
                            window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
                            window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);
                            renderUI();
                            window.App.showToast('✅ 已加载云端数据');
                        }
                    }
                }
            }
        } catch (e) { console.warn('Firebase加载跳过，使用本地数据'); }

        // ── 无论云端有没有数据，初始化阶段结束，解锁后续写操作的上传权限 ──
        _cloudLoadDone = true;
        console.log('✅ 云端加载阶段结束，上传保护已解除');

        // ── 实时监听：仅拉取，不回推 ──
        if (window._fbListenChanges) {
            window._fbListenChanges(
                function (cloudAccounts) {
                    // 忽略自己刚上传触发的回调（防循环）
                    if (!initDone || Date.now() - lastSyncTs < 2000) return;
                    window.App.accounts = Array.isArray(cloudAccounts) ? cloudAccounts : Object.values(cloudAccounts);
                    window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
                    window.App.renderHeader(); window.App.renderNormalDropdown(); window.App.renderAIDropdown();
                    window.App.showToast('☁️ 账号已同步');
                },
                function (cloudPosts) {
                    if (!initDone || Date.now() - lastSyncTs < 2000) return;
                    var rawPosts = Array.isArray(cloudPosts) ? cloudPosts : Object.values(cloudPosts);
                    window.App.posts = rawPosts.map(function (p) {
                        if (!p) return p;
                        p.likes = Array.isArray(p.likes) ? p.likes : (p.likes ? Object.values(p.likes) : []);
                        p.comments = Array.isArray(p.comments) ? p.comments : (p.comments ? Object.values(p.comments) : []);
                        p.images = Array.isArray(p.images) ? p.images : (p.images ? Object.values(p.images) : []);
                        p.videos = Array.isArray(p.videos) ? p.videos : (p.videos ? Object.values(p.videos) : []);
                        return p;
                    });
                    window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);
                    window.App.renderTimeline(true);
                    window.App.showToast('☁️ 动态已同步');
                }
            );
        }
    }

    window.App = window.App || {};
    window.App.refreshAll = refreshAll;
    window.App.init = init;
    window.App.toggleSearch = toggleSearch;
    window.App.exportData = exportData;
    window.App.importData = importData;
    window.App.sharePost = sharePost;
    window.App.copyPost = copyPost;
    window.App.copyComment = copyComment;
    window.App.searchActive = searchActive;
    window.App.forceLoadFromCloud = forceLoadFromCloud;
    window.App.manualUploadToCloud = manualUploadToCloud;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
