(function () {
    var $ = function (s) { return document.querySelector(s); };

    var searchActive = false;

    // ─────────────────────────────────────────────
    // 本地数据修改时间戳（内存中维护）
    // 任何写操作（发布/编辑/导入/手动上传）都应调用 markLocalDirty()
    // ─────────────────────────────────────────────
    var _localDataTs = parseInt(localStorage.getItem(window.App.NS + '_localDataTs') || '0', 10);
    function markLocalDirty() {
        _localDataTs = Date.now();
        localStorage.setItem(window.App.NS + '_localDataTs', String(_localDataTs));
    }
    // 暴露给 App 层，供 publish / saveAccounts 等地方调用
    window.App = window.App || {};
    window.App.markLocalDirty = markLocalDirty;

    // 普通账号排在 AI 账号前面
    function sortAccounts() {
        var accs = window.App.accounts;
        if (!accs) return;
        accs.sort(function (a, b) {
            if (a.isAI && !b.isAI) return 1;
            if (!a.isAI && b.isAI) return -1;
            return 0;
        });
    }

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
        // 上传真正写盘成功后，把“最近一次本地同步”刷新到当下：
        // 防止自己刚上传的实时回声晚于 2 秒保护窗到达时，把紧接着的本地新修改覆盖掉
        if (result && result.skipped === false && !result.error && window._onLocalSync) {
            window._onLocalSync();
        }
        // 数据上传失败：30 秒后自动重试一次（本地数据已落盘，不会丢）
        if (result && result.error && !window._cloudRetryPending) {
            window._cloudRetryPending = true;
            setTimeout(function () {
                window._cloudRetryPending = false;
                try { window.App.uploadToCloud(false); } catch (e) { }
            }, 30000);
        }
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
    function exportData() { showExportOptionsModal(); }

    function showExportOptionsModal() {
        var imgCount = 0;
        var vidCount = 0;
        (window.App.posts || []).forEach(function (p) {
            imgCount += (p.images || []).length;
            vidCount += (p.videos || []).length;
        });
        var totalMedia = imgCount + vidCount;
        var mediaText = totalMedia > 0
            ? ("共有 " + imgCount + " 张图片、" + vidCount + " 个视频（约需几秒到几分钟）")
            : "没有多媒体文件";

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal-dialog" style="max-width:340px;">' +
            '<h3>📤 导出数据</h3>' +
            '<label style="margin-top:10px;">导出内容</label>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button class="btn" id="exportScopeAll" style="flex:1;padding:8px 0;border-radius:8px;border:2px solid var(--accent);background:var(--primary-bg);color:var(--accent);font-weight:600;cursor:pointer;font-size:13px;">全部数据</button>' +
            '<button class="btn" id="exportScopeAccount" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);color:var(--text);cursor:pointer;font-size:13px;">仅账号</button>' +
            '</div>' +
            '<label style="margin-top:12px;">多媒体文件</label>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button class="btn" id="exportMediaYes" style="flex:1;padding:8px 0;border-radius:8px;border:2px solid var(--accent);background:var(--primary-bg);color:var(--accent);font-weight:600;cursor:pointer;font-size:13px;">包含媒体</button>' +
            '<button class="btn" id="exportMediaNo" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);color:var(--text);cursor:pointer;font-size:13px;">仅数据</button>' +
            '</div>' +
            '<p style="font-size:12px;color:var(--text-light);margin:8px 0 0;">' + mediaText + '</p>' +
            '<div class="btn-row" style="margin-top:16px;">' +
            '<button class="btn btn-cancel" id="exportOptionsCancel">取消</button>' +
            '<button class="btn btn-save" id="exportOptionsConfirm">📤 导出</button>' +
            '</div></div>';
        document.body.appendChild(overlay);

        var exportScope = 'all';
        var exportMedia = true;

        function setActive(activeId, inactiveId) {
            var a = overlay.querySelector('#' + activeId);
            var b = overlay.querySelector('#' + inactiveId);
            a.style.border = '2px solid var(--accent)';
            a.style.background = 'var(--primary-bg)';
            a.style.color = 'var(--accent)';
            a.style.fontWeight = '600';
            b.style.border = '1px solid var(--border)';
            b.style.background = 'var(--card-bg)';
            b.style.color = 'var(--text)';
            b.style.fontWeight = 'normal';
        }

        overlay.querySelector('#exportScopeAll').onclick = function () { exportScope = 'all'; setActive('exportScopeAll', 'exportScopeAccount'); };
        overlay.querySelector('#exportScopeAccount').onclick = function () { exportScope = 'account'; setActive('exportScopeAccount', 'exportScopeAll'); };
        overlay.querySelector('#exportMediaYes').onclick = function () { exportMedia = true; setActive('exportMediaYes', 'exportMediaNo'); };
        overlay.querySelector('#exportMediaNo').onclick = function () { exportMedia = false; setActive('exportMediaNo', 'exportMediaYes'); };

        overlay.querySelector('#exportOptionsCancel').onclick = function () { overlay.remove(); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#exportOptionsConfirm').onclick = async function () {
            overlay.remove();
            await doExport(exportScope, exportMedia);
        };
    }

    async function doExport(scope, includeMedia) {
        try {
            var exportPosts = scope === 'all' ? (window.App.posts || []) : [];
            var imgCount = 0;
            var vidCount = 0;
            var allMediaIds = [];
            exportPosts.forEach(function (p) {
                (p.images || []).forEach(function (id) { imgCount++; if (allMediaIds.indexOf(id) === -1) allMediaIds.push(id); });
                (p.videos || []).forEach(function (id) { vidCount++; if (allMediaIds.indexOf(id) === -1) allMediaIds.push(id); });
            });

            var data = {
                accounts: window.App.accounts,
                currentId: window.App.currentId,
                posts: exportPosts,
                aiConfig: window.App.aiConfig,
                aiPresets: window.App.aiPresets,
                activePresetId: window.App.activePresetId,
                activeAIId: window.App.activeAIId,
                randomAIMode: window.App.randomAIMode,
                savedQuotes: window.App.getSavedQuotes ? window.App.getSavedQuotes() : [],
                exportedAt: Date.now(),
                mediaStats: { images: imgCount, videos: vidCount }
            };

            var statsText = [
                "导出时间：" + new Date().toLocaleString(),
                "导出范围：" + (scope === 'all' ? '全部数据' : '仅账号'),
                "图片数量：" + imgCount,
                "视频数量：" + vidCount,
                "账号数量：" + (window.App.accounts || []).length,
                "动态数量：" + exportPosts.length
            ].join("\n");

            if (includeMedia && allMediaIds.length > 0 && typeof JSZip !== "undefined") {
                window.App.showProgress("正在导出数据...");
                var zip = new JSZip();
                zip.file("data.json", JSON.stringify(data, null, 2));
                zip.file("media_stats.txt", statsText);

                var mediaFolder = zip.folder("media");
                for (var i = 0; i < allMediaIds.length; i++) {
                    var mid = allMediaIds[i];
                    var blob = null;
                    var isVideo = (exportPosts || []).some(function (p) {
                        return (p.videos || []).indexOf(mid) !== -1;
                    });
                    var ext = isVideo ? ".mp4" : ".jpg";

                    window.App.showProgress("正在打包 " + (i + 1) + "/" + allMediaIds.length + "...");

                    try { var rec = await window.App.getMedia(mid); if (rec && rec.blob) blob = rec.blob; } catch (e) { }
                    if (!blob && window._fbDownloadMedia) { try { blob = await window._fbDownloadMedia(mid); } catch (e) { } }
                    if (!blob) { try { var u = await window.App.loadMediaUrl(mid); if (u) { var r = await fetch(u); if (r.ok) blob = await r.blob(); } } catch (e) { } }

                    if (blob) mediaFolder.file(mid + ext, blob);
                }
                window.App.showProgress("正在生成压缩包...");

                var zipBlob = await zip.generateAsync({ type: "blob" });
                window.App.hideProgress();
                var url = URL.createObjectURL(zipBlob);
                var a = document.createElement("a");
                a.href = url;
                a.download = "moments-backup-" + new Date().toISOString().slice(0, 10) + ".zip";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                window.App.showProgress("正在导出...");
                if (typeof JSZip !== "undefined") {
                    var zip2 = new JSZip();
                    zip2.file("data.json", JSON.stringify(data, null, 2));
                    zip2.file("media_stats.txt", statsText);
                    var zipBlob2 = await zip2.generateAsync({ type: "blob" });
                    window.App.hideProgress();
                    var url2 = URL.createObjectURL(zipBlob2);
                    var a2 = document.createElement("a");
                    a2.href = url2;
                    a2.download = "moments-backup-" + new Date().toISOString().slice(0, 10) + ".zip";
                    document.body.appendChild(a2);
                    a2.click();
                    document.body.removeChild(a2);
                    URL.revokeObjectURL(url2);
                } else {
                    var json = JSON.stringify(data, null, 2);
                    var outBlob = new Blob([json], { type: "application/json" });
                    window.App.hideProgress();
                    var url3 = URL.createObjectURL(outBlob);
                    var a3 = document.createElement("a");
                    a3.href = url3;
                    a3.download = "moments-backup-" + new Date().toISOString().slice(0, 10) + ".json";
                    document.body.appendChild(a3);
                    a3.click();
                    document.body.removeChild(a3);
                    URL.revokeObjectURL(url3);
                }
            }

            window.App.showToast("✅ 导出完成");
        } catch (e) {
            window.App.hideProgress();
            console.error("导出失败:", e);
            window.App.showToast("导出失败");
        }
    }

    // === 数据导入 ===
    async function importData(file) {
        console.log("[导入] 开始, file:", file.name, file.size, "bytes");
        window.App.showProgress("正在读取...");
        try {
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

        sortAccounts();
        window.App.currentId = data.currentId || (window.App.accounts.find(function (a) { return !a.isAI; }) || window.App.accounts[0] || {}).id || "";
        if (data.aiPresets && data.aiPresets.length) { var curPresetId3 = window.App.activePresetId; window.App.aiPresets = data.aiPresets; window.App.activePresetId = (curPresetId3 && window.App.aiPresets.find(function (p) { return p.id === curPresetId3; })) ? curPresetId3 : (data.activePresetId || data.aiPresets[0].id); window.App.aiConfig = window.App.aiPresets.find(function (p) { return p.id === window.App.activePresetId; }) || window.App.aiPresets[0]; }
        window.App.activeAIId = data.activeAIId || null;
        // randomAIMode 是本地偏好，不从云端覆盖（localStorage 才是最新值）
        if (data.savedQuotes && Array.isArray(data.savedQuotes)) {
            localStorage.setItem(window.App.NS + 'saved_quotes', JSON.stringify(data.savedQuotes));
        }

        await window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
        await window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);
        localStorage.setItem(window.App.KEY_CUR, window.App.currentId);
        window.App.saveAIPresets();
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
        console.log("[导入-应用] 同步到Cloudflare（强制上传）...");
        if (window._fbSyncImmediate) {
            try {
                var ts = await window._fbSyncImmediate(window.App.accounts, window.App.posts);
                if (ts) {
                    _localDataTs = ts;
                    localStorage.setItem(window.App.NS + '_localDataTs', String(ts));
                }
                console.log("[导入-应用] Cloudflare同步完成");
            } catch (e) {
                console.error("[导入-应用] Cloudflare同步失败:", e);
            }
        } else {
            console.warn("[导入-应用] _fbSyncImmediate 不可用，跳过Cloudflare同步");
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
            comments: post.comments.map(function (c) {
                var cu = window.App.getAcc(c.userId) || { nickname: '未知' };
                return {
                    text: c.text,
                    timestamp: c.timestamp,
                    user: { nickname: cu.nickname, isAI: !!cu.isAI }
                };
            })
        };
        if (post.ghostWriter) {
            var ghostAcc = window.App.getAcc(post.ghostWriter);
            shared.ghostWriter = {
                nickname: ghostAcc ? ghostAcc.nickname : 'AI',
                isAI: true
            };
            shared.ghostInput = post.ghostInput || '';
        }

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

    // === 链接分享 ===
    async function shareLink(id) {
        var post = (window.App.posts || []).find(function (p) { return p.id === id; });
        if (!post) return;

        // 收集所有涉及的账号
        var accountsMap = {};
        function addAcc(uid) {
            if (!uid || accountsMap[uid]) return;
            var acc = window.App.getAcc(uid);
            if (acc) accountsMap[uid] = acc;
        }
        addAcc(post.userId);
        if (post.ghostWriter) addAcc(post.ghostWriter);
        (post.comments || []).forEach(function (c) { addAcc(c.userId); });

        // 上传快照并获取链接
        var relativeUrl = await window._fbSharePost(post, accountsMap);
        if (!relativeUrl) {
            window.App.showToast('❌ 生成链接失败');
            return;
        }

        // 构建完整 URL
        var fullUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + relativeUrl;

        // 弹窗显示
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML =
            '<div class="modal-dialog modal-dialog-sm" style="max-width:400px;">' +
            '<h3 style="margin-bottom:8px;">🔗 分享链接</h3>' +
            '<p style="font-size:12px;color:var(--text-light);margin-bottom:12px;">复制下方链接发给朋友，即可查看这条动态</p>' +
            '<input type="text" readonly value="' + window.App.escapeHtml(fullUrl) + '" style="width:100%;padding:8px 10px;border:1.5px solid var(--input-border);border-radius:8px;font-size:13px;background:var(--input-bg);color:var(--text);margin-bottom:12px;" id="shareLinkInput" onclick="this.select()">' +
            '<div class="btn-row" style="justify-content:center;gap:10px;">' +
            '<button class="btn btn-cancel" id="closeShareLink">关闭</button>' +
            '<button class="btn btn-save" id="copyShareLink">📋 复制链接</button>' +
            '</div></div>';
        document.body.appendChild(overlay);

        overlay.querySelector('#closeShareLink').onclick = function () { overlay.remove(); };
        overlay.querySelector('#copyShareLink').onclick = function () {
            var inp = overlay.querySelector('#shareLinkInput');
            inp.select();
            navigator.clipboard && navigator.clipboard.writeText
                ? navigator.clipboard.writeText(fullUrl).then(function () { window.App.showToast('📋 链接已复制'); }).catch(function () { fallbackCopy(fullUrl); })
                : fallbackCopy(fullUrl);
        };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        // 自动复制
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullUrl).then(function () {
                window.App.showToast('📋 链接已复制到剪贴板');
            }).catch(function () { fallbackCopy(fullUrl); });
        } else {
            fallbackCopy(fullUrl);
        }
    }

    function copyPost(id) {
        var post = (window.App.posts || []).find(function (p) { return p.id === id; });
        if (!post) return;

        var lines = [];
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

        var text = (comment.text || '');
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

            window.App.accounts = toArray(cloudData.accounts);
            window.App.posts = toArray(cloudData.posts || []).map(fixPost);
            sortAccounts();

            // 加载云端 AI 配置（手动强制拉取，不自动上传）
            if (cloudData.aiConfig && cloudData.aiConfig.presets && cloudData.aiConfig.presets.length) {
                var curPresetId2 = window.App.activePresetId;
                window.App.aiPresets = cloudData.aiConfig.presets;
                window.App.normalizeAIPresets();
                window.App.activePresetId = (curPresetId2 && window.App.aiPresets.find(function (p) { return p.id === curPresetId2; })) ? curPresetId2 : (cloudData.aiConfig.activePresetId || window.App.aiPresets[0].id);
                window.App.aiConfig = window.App.aiPresets.find(function (p) { return p.id === window.App.activePresetId; }) || window.App.aiPresets[0];
                window.App.saveAIPresets();
            }

            await window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
            await window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);

            // 加载云端收藏语录
            if (window._fbPullSavedQuotes) {
                var cloudQuotes = await window._fbPullSavedQuotes();
                if (cloudQuotes && cloudQuotes.length) {
                    localStorage.setItem(window.App.NS + 'saved_quotes', JSON.stringify(cloudQuotes));
                }
            }

            // 将本地时间戳对齐为云端时间戳，避免下次误判为本地更新
            var cloudTs = cloudData._cloudTs || Date.now();
            _localDataTs = cloudTs;
            localStorage.setItem(window.App.NS + '_localDataTs', String(cloudTs));

            window.App.hideProgress();
            var _savedRandomAI = window.App.randomAIMode;
            renderUI();
            window.App.randomAIMode = _savedRandomAI;
            localStorage.setItem(window.App.KEY_RANDOM_AI, _savedRandomAI ? 'true' : 'false');
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
            // 同时上传收藏语录
            if (window._fbUploadSavedQuotes && window.App.getSavedQuotes) {
                await window._fbUploadSavedQuotes(window.App.getSavedQuotes());
            }
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
                    var left = rect.left + rect.width / 2 - dropdownWidth / 2;
                    left = Math.max(8, Math.min(left, window.innerWidth - dropdownWidth - 38));
                    $aiDropdown.style.left = left + 'px';
                    $aiDropdown.style.display = 'block';
                    window.App.renderAIDropdown();
                }
            };
        }

        var $aiDropdown = $('#aiDropdown');
        if ($aiDropdown) {
            $aiDropdown.onclick = function (e) { e.stopPropagation(); };
        }

        // 侧边栏普通账号区域点击
        var sidebarUserArea = $('#sidebarUserArea');
        if (sidebarUserArea) {
            sidebarUserArea.onclick = function (e) {
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

        // 侧边栏 AI 账号区域点击
        var sidebarAIArea = $('#sidebarAIArea');
        if (sidebarAIArea) {
            sidebarAIArea.onclick = function (e) {
                e.stopPropagation();
                var $aiDropdown = $('#aiDropdown');
                if (!$aiDropdown) return;
                var isOpen = $aiDropdown.style.display === 'block';
                window.App.closeAllDropdowns();
                if (!isOpen) {
                    var rect = e.currentTarget.getBoundingClientRect();
                    var dropdownWidth = $aiDropdown.offsetWidth || 220;
                    $aiDropdown.style.top = (rect.bottom + 4) + 'px';
                    var left = rect.left + rect.width / 2 - dropdownWidth / 2;
                    left = Math.max(8, Math.min(left, window.innerWidth - dropdownWidth - 8));
                    $aiDropdown.style.left = left + 'px';
                    $aiDropdown.style.display = 'block';
                    window.App.renderAIDropdown();
                }
            };
        }

        // 侧边栏导航点击
        var sidebar = $('#sidebar');
        if (sidebar) {
            sidebar.addEventListener('click', function (e) {
                var item = e.target.closest('.sidebar-nav-item');
                if (!item) return;
                var action = item.dataset.action;

                // 高亮当前项
                sidebar.querySelectorAll('.sidebar-nav-item').forEach(function (el) {
                    el.classList.remove('active');
                });
                item.classList.add('active');

                switch (action) {
                    case 'publish':
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        var pubText = document.getElementById('publishText');
                        if (pubText) {
                            pubText.focus();
                        }
                        break;
                    case 'toggle-theme':
                        document.body.classList.toggle('dark-mode');
                        var dark = document.body.classList.contains('dark-mode');
                        window.App.showToast(dark ? '🌙 已切换深色模式' : '☀️ 已切换浅色模式');
                        var themeItem = $('#settingsThemeItem');
                        if (themeItem) themeItem.textContent = dark ? '☀️ 切换浅色模式' : '🌙 切换深色模式';
                        if (item) item.textContent = dark ? '☀️ 浅色模式' : '🌙 深色模式';
                        var dtb = document.getElementById('desktopThemeBtn');
                        if (dtb) dtb.textContent = dark ? '☀️ 浅色模式' : '🌙 深色模式';
                        break;
                    case 'search':
                        if (window.innerWidth > 768) {
                            var dsi = document.getElementById('desktopSearchInput');
                            if (dsi) { dsi.focus(); dsi.select(); }
                        } else {
                            window.App.toggleSearch();
                        }
                        break;
                    case 'ai-settings':
                        window.App.openAISettings();
                        break;
                    case 'ai-post':
                        window.App.openAIPostModal();
                        break;
                    case 'ghost-writer':
                        window.App.openGhostWriterModal();
                        break;
                    case 'export':
                        exportData();
                        break;
                    case 'import':
                        var inp2 = document.createElement('input');
                        inp2.type = 'file';
                        inp2.accept = '.zip,.json';
                        inp2.onchange = function () { if (inp2.files[0]) importData(inp2.files[0]); };
                        inp2.click();
                        break;
                    case 'upload-cloud':
                        manualUploadToCloud();
                        break;
                    case 'chat':
                        window.open('chat.html' + (window.App.namespaceName ? '?ns=' + encodeURIComponent(window.App.namespaceName) : ''), '_self');
                        break;
                    case 'navigate':
                        window.open('navigate.html', '_blank');
                        break;
                    case 'saved-quotes':
                        window.App.showSavedQuotesModal();
                        break;
                }
            });
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
                    if (themeItem) themeItem.textContent = isDark ? '☀️ 切换浅色模式' : '🌙 切换深色模式';
                    var dtb = document.getElementById('desktopThemeBtn');
                    if (dtb) dtb.textContent = isDark ? '☀️ 浅色模式' : '🌙 深色模式';
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
                        var dark3 = document.body.classList.contains('dark-mode');
                        window.App.showToast(dark3 ? '🌙 已切换深色模式' : '☀️ 已切换浅色模式');
                        var themeItem3 = $('#settingsThemeItem');
                        if (themeItem3) themeItem3.textContent = dark3 ? '☀️ 切换浅色模式' : '🌙 切换深色模式';
                        var dtb = document.getElementById('desktopThemeBtn');
                        if (dtb) dtb.textContent = dark3 ? '☀️ 浅色模式' : '🌙 深色模式';
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
                    case 'ghost-writer':
                        window.App.openGhostWriterModal();
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
                    case 'upload-cloud':
                        manualUploadToCloud();
                        break;
                    case 'chat':
                        window.open('chat.html' + (window.App.namespaceName ? '?ns=' + encodeURIComponent(window.App.namespaceName) : ''), '_self');
                        break;
                    case 'navigate':
                        window.open('navigate.html', '_blank');
                        break;
                    case 'about':
                        window.location.href = 'about.html';
                        break;
                    case 'saved-quotes':
                        window.App.showSavedQuotesModal();
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

        var btnExpand = $('#btnExpand');
        if (btnExpand) {
            btnExpand.onclick = function () {
                const area = document.querySelector('.publish-area');
                if (!area) return;
                const isExpanded = area.classList.toggle('expanded');
                btnExpand.textContent = isExpanded ? '🤫' : '⛶';
                btnExpand.title = isExpanded ? '收起' : '展开';
                if (isExpanded) {
                    const ta = document.getElementById('publishText');
                    if (ta) { ta.style.height = 'auto'; ta.style.overflowY = 'auto'; }
                } else {
                    const ta = document.getElementById('publishText');
                    if (ta) { ta.style.height = ''; ta.style.overflowY = ''; }
                }
            };
        }

        var imageInput = $('#imageInput');
        if (imageInput) {
            imageInput.onchange = function () {
                for (var i = 0; i < this.files.length; i++) {
                    window.App.addPublishFile(this.files[i], 'image');
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
                window.App.addPublishFile(f, 'video');
                window.App.renderPublishPreview();
                window.App.updatePublishBtn();
                this.value = '';
            };
        }

        // 输入框拖入图片/视频
        var publishArea = document.querySelector('.publish-area');
        if (publishArea) {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (ev) {
                publishArea.addEventListener(ev, function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });
            publishArea.addEventListener('dragenter', function () {
                publishArea.classList.add('drag-over');
            });
            publishArea.addEventListener('dragleave', function (e) {
                if (publishArea.contains(e.relatedTarget)) return;
                publishArea.classList.remove('drag-over');
            });
            publishArea.addEventListener('drop', function (e) {
                publishArea.classList.remove('drag-over');
                var files = e.dataTransfer.files;
                if (!files || !files.length) return;
                var accepted = 0;
                for (var i = 0; i < files.length; i++) {
                    var f = files[i];
                    if (f.type.indexOf('image/') === 0) {
                        if (window.App.addPublishFile(f, 'image')) accepted++;
                    } else if (f.type.indexOf('video/') === 0) {
                        if (window.App.addPublishFile(f, 'video')) accepted++;
                    }
                }
                window.App.renderPublishPreview();
                window.App.updatePublishBtn();
                if (accepted) window.App.showToast('📥 已拖入文件');
            });
        }

        // 输入框粘贴图片
        var publishText = $('#publishText');
        if (publishText) {
            publishText.addEventListener('paste', function (e) {
                var items = e.clipboardData && e.clipboardData.items;
                if (!items) return;
                var hasImage = false;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image/') === 0) {
                        e.preventDefault();
                        var file = items[i].getAsFile();
                        if (!file) continue;
                        if (window.App.addPublishFile(file, 'image')) {
                            window.App.renderPublishPreview();
                            window.App.updatePublishBtn();
                            hasImage = true;
                        }
                    }
                }
                if (hasImage) window.App.showToast('📋 已粘贴图片');
            });
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

        // 桌面端搜索框
        var desktopSearchInput = document.getElementById('desktopSearchInput');
        var desktopSearchClear = document.getElementById('desktopSearchClear');
        if (desktopSearchInput) {
            desktopSearchInput.addEventListener('input', function () {
                var q = desktopSearchInput.value.trim();
                if (desktopSearchClear) desktopSearchClear.style.display = q ? 'block' : 'none';
                window.App.renderSearchResults(q);
            });
        }
        if (desktopSearchClear) {
            desktopSearchClear.addEventListener('click', function () {
                desktopSearchInput.value = '';
                desktopSearchClear.style.display = 'none';
                window.App.renderTimeline(true);
            });
        }

        // 桌面端夜间模式按钮
        var desktopThemeBtn = document.getElementById('desktopThemeBtn');
        if (desktopThemeBtn) {
            desktopThemeBtn.addEventListener('click', function () {
                document.body.classList.toggle('dark-mode');
                var isDark = document.body.classList.contains('dark-mode');
                window.App.showToast(isDark ? '🌙 已切换深色模式' : '☀️ 已切换浅色模式');
                desktopThemeBtn.textContent = isDark ? '☀️ 浅色模式' : '🌙 深色模式';
                var themeItem = $('#settingsThemeItem');
                if (themeItem) themeItem.textContent = isDark ? '☀️ 切换浅色模式' : '🌙 切换深色模式';
            });
        }

        // 语录刷新按钮
        var btnQuoteRefresh = document.getElementById('btnQuoteRefresh');
        if (btnQuoteRefresh) {
            btnQuoteRefresh.addEventListener('click', function () {
                window.App.refreshQuote();
            });
        }

        // 语录收藏按钮
        var btnQuoteFav = document.getElementById('btnQuoteFav');
        if (btnQuoteFav) {
            btnQuoteFav.addEventListener('click', function () {
                window.App.toggleQuoteFav();
            });
        }

    }

    document.addEventListener('input', function (e) {
        if (e.target && e.target.matches &&
            (e.target.matches('textarea[id^="commentInput-"]') || e.target.id === 'publishText')) {
            const ta = e.target;
            const maxH = ta.id === 'publishText' ? 145 : 115;
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px';
            ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
            // 发帖框至少3行才显示展开按钮
            if (ta.id === 'publishText') {
                const btn = document.getElementById('btnExpand');
                if (btn) btn.style.display = ta.scrollHeight >= 72 ? '' : 'none';
            }
        }
    });

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

    var _isLoadingMore = false;

    var _loaderObserver = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;      // loader 没进视口，不管
        if (window.App.searchActive) return;
        if (_isLoadingMore) return;

        var posts = window.App.posts || [];
        var renderedCount = window.App.renderedCount || 0;
        if (renderedCount >= posts.length) {
            var loader = document.querySelector('#loaderIndicator');
            if (loader) loader.style.display = 'none';
            return;
        }

        _isLoadingMore = true;                        // ✅ 上锁
        setTimeout(function () {
            try {
                window.App.renderTimeline(false);
            } catch (e) {
                console.error('加载更多失败:', e);
                var loader2 = document.querySelector('#loaderIndicator');
                if (loader2) loader2.style.display = 'none';
            } finally {
                _isLoadingMore = false;               // 解锁
            }
        }, 200);
    }, { threshold: 0.1 });

    // 页面就绪后开始观察
    (function attachObserver() {
        var loader = document.querySelector('#loaderIndicator');
        if (loader) {
            _loaderObserver.observe(loader);
        } else {
            // loader 还没渲染出来，等一下再试
            setTimeout(attachObserver, 300);
        }
    })();

    var theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        document.body.classList.toggle('dark-mode', e.matches);
        var dtb = document.getElementById('desktopThemeBtn');
        if (dtb) dtb.textContent = e.matches ? '☀️ 浅色模式' : '🌙 深色模式';
        var tm = document.getElementById('settingsThemeItem');
        if (tm) tm.textContent = e.matches ? '☀️ 切换浅色模式' : '🌙 切换深色模式';
    });
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
    // 设置桌面端初始主题按钮文字
    var dtbInit = document.getElementById('desktopThemeBtn');
    if (dtbInit) dtbInit.textContent = theme === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式';

    async function refreshAll() {
        try {
            window.App.accounts = (await window.App.getAppData(window.App.KEY_ACC)) || [];
            window.App.currentId = localStorage.getItem(window.App.KEY_CUR);
            window.App.posts = (await window.App.getAppData(window.App.KEY_POSTS)) || [];
            var activeP = (window.App.aiPresets || []).find(function (p) { return p.id === window.App.activePresetId; });
            if (activeP) window.App.aiConfig = activeP;
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

        // 命名空间标识
        var nsName = window.App.namespaceName;
        if (nsName) {
            document.title = nsName + ' - 朋友圈';
            var banner = document.getElementById('namespaceBanner');
            if (banner) {
                banner.textContent = '📦 ' + nsName;
                banner.style.display = 'block';
            }
        }
        // 同步命名空间到桌面顶栏
        var topbarNs = document.getElementById('topbarNamespace');
        if (topbarNs) {
            topbarNs.textContent = nsName || '';
        }

        document.addEventListener('keydown', function (e) {
            const publishText = document.getElementById('publishText');
            if (publishText && document.activeElement === publishText) {
                // 设备没有精细指针（鼠标/触控板） → 视为纯触摸移动设备
                var isMobile = window.matchMedia('not (pointer: fine)').matches;

                var shouldPublish = isMobile
                    ? (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing)
                    : (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing);

                if (shouldPublish) {
                    e.preventDefault();
                    window.App.publish();
                    return;
                }
            }

            if (e.target && e.target.matches && e.target.matches('textarea[id^="commentInput-"]')) {
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

        // 自动生成语录（仅桌面模式，移动端 ≤768px 时 UI 被 CSS 隐藏）
        var aiAccs = window.App.accounts.filter(function (a) { return a.isAI; });
        var quoteSection = document.getElementById('quoteSection');
        if (quoteSection) {
            if (aiAccs.length > 0 && window.innerWidth > 768) {
                quoteSection.classList.remove('no-ai');
                window.App.refreshQuote();
            } else if (aiAccs.length === 0) {
                quoteSection.classList.add('no-ai');
            }
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
            sortAccounts();

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
        // 本地数据就绪：检查是否有可恢复的草稿/发布快照
        try { if (window.App.onLocalDataReady) window.App.onLocalDataReady(); } catch (e) { }

        // Step 3: 异步加载云端数据（云端优先，拉下来覆盖本地）
        loadCloudflareInBackground();

        window.debug = { clearMediaCache: window.App.clearMediaCache, refreshAll: refreshAll, openDB: window.App.openDB, getMedia: window.App.getMedia, posts: window.App.posts };
    }

    // ─────────────────────────────────────────────
    // Cloudflare 后台加载：云端数据优先，单向拉取
    // 不自动上传，只接收云端推送
    // ─────────────────────────────────────────────
    async function loadCloudflareInBackground() {
        var lastSyncTs = 0;
        window._onLocalSync = function () { lastSyncTs = Date.now(); };
        var initDone = false;
        // 云端初载快照比本地旧（本地在加载期间已有新写入）时置 true，结束时把本地补传到云端
        var cloudStale = false;
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
                                localStorage.setItem(window.App.NS + '_localDataTs', String(cloudTs));
                            }

                            // ⚠️ 关键保护：云端数据在加载期间，用户可能已经抢先发布/编辑了内容
                            //（此时上传仍被 _cloudLoadDone 锁住，新内容只写进了本地）。
                            // 若云端时间戳比本地旧还强行用云端旧快照覆盖本地，
                            // 刚发布/编辑的内容会被当场冲掉（表现为“点发布后内容丢失”）。
                            if (cloudTs > 0 && _localDataTs > cloudTs) {
                                cloudStale = true;
                                console.log('⏭️ 云端初载快照比本地旧，保留本地数据（避免覆盖加载期间刚发布/编辑的内容）');
                            } else {

                            window.App.accounts = cloudData.accounts;
                            window.App.posts = cloudData.posts;
                            sortAccounts();
                            // 加载云端 AI 配置（仅初始加载，不自动上传）
                            if (cloudData.aiConfig && cloudData.aiConfig.presets && cloudData.aiConfig.presets.length) {
                                var curPresetId = window.App.activePresetId;
                                window.App.aiPresets = cloudData.aiConfig.presets;
                                window.App.normalizeAIPresets();
                                window.App.activePresetId = (curPresetId && window.App.aiPresets.find(function (p) { return p.id === curPresetId; })) ? curPresetId : (cloudData.aiConfig.activePresetId || window.App.aiPresets[0].id);
                                window.App.aiConfig = window.App.aiPresets.find(function (p) { return p.id === window.App.activePresetId; }) || window.App.aiPresets[0];
                                window.App.saveAIPresets();
                            }
                            window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
                            window.App.saveAppData(window.App.KEY_POSTS, window.App.posts);
                            // 加载云端收藏语录
                            if (window._fbPullSavedQuotes) {
                                window._fbPullSavedQuotes().then(function (cloudQuotes) {
                                    if (cloudQuotes && cloudQuotes.length) {
                                        localStorage.setItem(window.App.NS + 'saved_quotes', JSON.stringify(cloudQuotes));
                                    }
                                });
                            }
                            // 保护 randomAIMode 不被云端数据覆盖
                            var _savedRandomAI = window.App.randomAIMode;
                            renderUI();
                            window.App.randomAIMode = _savedRandomAI;
                            localStorage.setItem(window.App.KEY_RANDOM_AI, _savedRandomAI ? 'true' : 'false');

                            // 有效性检查：currentId 无效或指向 AI 账号时，自动选第一个普通账号
                            var curId = window.App.currentId;
                            var curAcc = window.App.accounts.find(function (a) { return a.id === curId; });
                            if (!curAcc || curAcc.isAI) {
                                var firstNormal = window.App.accounts.find(function (a) { return !a.isAI; });
                                if (firstNormal) {
                                    window.App.currentId = firstNormal.id;
                                    localStorage.setItem(window.App.KEY_CUR, firstNormal.id);
                                }
                            }

                            window.App.showToast('✅ 已加载云端数据');
                            }
                        }
                    }
                }
            }
        } catch (e) { console.warn('Cloudflare加载跳过，使用本地数据'); }

        // ── 无论云端有没有数据，初始化阶段结束，解锁后续写操作的上传权限 ──
        _cloudLoadDone = true;
        console.log('✅ 云端加载阶段结束，上传保护已解除');

        // 云端初载快照比本地旧（例如加载期间用户已抢先发布/编辑，上传被锁没有执行）
        // → 此时把本地最新数据补传到云端，修复两边的分歧，避免内容留在本地却不再同步
        if (cloudStale && window.App.accounts && window.App.accounts.length) {
            try { await window.App.uploadToCloud(false); } catch (e) { }
        }

        // 云端数据最终状态已确定：刷新草稿/发布丢失恢复条（此时判断“帖子是否存在”最准确）
        try { if (window.App.onCloudInitDone) window.App.onCloudInitDone(); } catch (e) { }

        // ── 实时监听：仅拉取，不回推 ──
        if (window._fbListenChanges) {
            window._fbListenChanges(
                function (cloudAccounts) {
                    // 忽略自己刚上传触发的回调（防循环）
                    if (!initDone || Date.now() - lastSyncTs < 2000) return;
                    // 发布处理中不整体替换，避免打断进行中的保存
                    if (window.App._publishing) return;
                    window.App.accounts = Array.isArray(cloudAccounts) ? cloudAccounts : Object.values(cloudAccounts);
                    sortAccounts();
                    window.App.saveAppData(window.App.KEY_ACC, window.App.accounts);
                    markLocalDirty();
                    window.App.renderHeader(); window.App.renderNormalDropdown(); window.App.renderAIDropdown();
                    window.App.showToast('☁️ 账号已同步');
                },
                function (cloudPosts) {
                    if (!initDone || Date.now() - lastSyncTs < 2000) return;
                    // 发布处理中不整体替换 posts，避免云端旧快照冲掉刚发布的内容
                    if (window.App._publishing) return;
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
                    markLocalDirty();
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
    window.App.shareLink = shareLink;
    window.App.copyPost = copyPost;
    window.App.copyComment = copyComment;
    window.App.searchActive = searchActive;
    // 收藏语录持久化
    var KEY_SAVED_QUOTES = window.App.NS + 'saved_quotes';
    function getSavedQuotes() {
        try { return JSON.parse(localStorage.getItem(KEY_SAVED_QUOTES) || '[]'); } catch (e) { return []; }
    }
    function syncSavedQuotesToCloud() {
        if (window._fbUploadSavedQuotes) {
            window._fbUploadSavedQuotes(getSavedQuotes());
        }
    }
    function saveQuote(quote) {
        var list = getSavedQuotes();
        var dup = list.some(function (q) { return q.text === quote.text && q.aiName === quote.aiName; });
        if (!dup) {
            list.push({ text: quote.text, aiName: quote.aiName, aiId: quote.aiId, savedAt: Date.now() });
            localStorage.setItem(KEY_SAVED_QUOTES, JSON.stringify(list));
            syncSavedQuotesToCloud();
        }
    }
    function removeSavedQuote(idx) {
        var list = getSavedQuotes();
        list.splice(idx, 1);
        localStorage.setItem(KEY_SAVED_QUOTES, JSON.stringify(list));
        syncSavedQuotesToCloud();
    }
    function isQuoteSaved(quote) {
        if (!quote) return false;
        var list = getSavedQuotes();
        return list.some(function (q) { return q.text === quote.text && q.aiName === quote.aiName; });
    }

    // 语录状态
    var currentQuote = null;
    var currentQuoteFaved = false;

    async function refreshQuote() {
        var btnRefresh = document.getElementById('btnQuoteRefresh');
        var btnFav = document.getElementById('btnQuoteFav');
        if (btnRefresh) btnRefresh.disabled = true;
        if (btnFav) btnFav.disabled = true;

        if (window.App.showQuoteLoading) window.App.showQuoteLoading();

        var result = await window.App.generateAIQuote();
        if (btnRefresh) btnRefresh.disabled = false;
        if (btnFav) btnFav.disabled = false;

        if (result) {
            currentQuote = result;
            currentQuoteFaved = isQuoteSaved(result);
            if (window.App.renderQuoteCard) window.App.renderQuoteCard(result);
            if (btnFav) btnFav.textContent = currentQuoteFaved ? '❤️' : '🤍';
        }
    }

    function toggleQuoteFav() {
        if (!currentQuote) return;
        var btnFav = document.getElementById('btnQuoteFav');
        if (currentQuoteFaved) {
            // 取消收藏
            var list = getSavedQuotes();
            var idx = list.findIndex(function (q) { return q.text === currentQuote.text && q.aiName === currentQuote.aiName; });
            if (idx !== -1) removeSavedQuote(idx);
            currentQuoteFaved = false;
            if (btnFav) btnFav.textContent = '🤍';
            window.App.showToastBottom('已取消收藏');
        } else {
            saveQuote(currentQuote);
            currentQuoteFaved = true;
            if (btnFav) btnFav.textContent = '❤️';
            window.App.showToastBottom('❤️ 已收藏语录');
        }
    }

    window.App.getSavedQuotes = getSavedQuotes;
    window.App.saveQuote = saveQuote;
    window.App.removeSavedQuote = removeSavedQuote;
    window.App.isQuoteSaved = isQuoteSaved;
    window.App.refreshQuote = refreshQuote;
    window.App.toggleQuoteFav = toggleQuoteFav;

    window.App.forceLoadFromCloud = forceLoadFromCloud;
    window.App.manualUploadToCloud = manualUploadToCloud;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
