// publish.js

(function () {
    const $ = (s) => document.querySelector(s);

    let editingPostUserId = null; // 与 App 共享

    function renderPostUserSwitcher() {
        const toolbar = document.querySelector('.publish-toolbar');
        if (!toolbar) return;
        // 移除旧的切换器
        const old = document.getElementById('postUserSwitcher');
        if (old) old.remove();

        // 只在编辑状态下显示
        if (!window.App.editingPostId) return;

        const userId = window.App.editingPostUserId || window.App.currentId;
        const acc = window.App.getAcc(userId);
        if (!acc) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'postUserSwitcher';
        wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
        wrapper.innerHTML = `
        <span style="font-size:12px;color:var(--text-light);">发布者：</span>
        <span style="font-weight:600;color:var(--text);">${window.App.escapeHtml(acc.nickname)}</span>
        <button class="publish-tool-btn" id="switchPostUserBtn">切换</button>
    `;
        toolbar.parentNode.insertBefore(wrapper, toolbar);

        document.getElementById('switchPostUserBtn').onclick = (e) => {
            e.stopPropagation();
            showUserPicker();
        };
    }

    function showUserPicker() {
        const accounts = window.App.accounts;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const listHtml = accounts.map(a => {
            const isSelected = a.id === (window.App.editingPostUserId || window.App.currentId);
            let avHtml;
            if (a.avatar?.startsWith('data:')) {
                avHtml = `<img class="avatar-sm" src="${a.avatar}">`;
            } else if (a.avatarText) {
                avHtml = `<div class="avatar-placeholder-sm" style="background:${a.avatarBg};font-size:${window.App.isEmoji(a.avatarText) ? '18px' : '12px'}">${window.App.escapeHtml(a.avatarText)}</div>`;
            } else {
                avHtml = `<div class="avatar-placeholder-sm" style="background:${a.avatarBg}">${a.nickname.charAt(0).toUpperCase()}</div>`;
            }
            return `
            <div class="user-picker-item" data-id="${a.id}" style="background:${isSelected ? 'var(--btn-hover-bg)' : 'transparent'}">
                ${avHtml}
                <span>${window.App.escapeHtml(a.nickname)}</span>
                ${a.isAI ? '<span style="font-size:10px;color:var(--ai-purple);">AI</span>' : ''}
                ${isSelected ? '<span style="margin-left:auto;color:var(--accent);">✓</span>' : ''}
            </div>
        `;
        }).join('');

        overlay.innerHTML = `
        <div class="modal-dialog modal-dialog-sm">
            <h3>选择发布者</h3>
            <div class="user-picker-list">${listHtml}</div>
            <div class="btn-row" style="justify-content:center;margin-top:12px;">
                <button class="btn btn-cancel" id="cancelUserPicker">取消</button>
            </div>
        </div>
    `;
        document.body.appendChild(overlay);

        overlay.querySelector('#cancelUserPicker').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelectorAll('.user-picker-item').forEach(item => {
            item.onclick = () => {
                window.App.editingPostUserId = item.dataset.id;
                overlay.remove();
                renderPostUserSwitcher();
                // 更新发布按钮文字，以提示身份
                const btnPublish = document.getElementById('btnPublish');
                if (btnPublish) {
                    const acc = window.App.getAcc(window.App.editingPostUserId);
                    btnPublish.textContent = acc ? `以${acc.nickname}身份发布` : '保存修改';
                }
            };
        });
    }

    // 在 cancelEdit 中也要清除切换器
    const originalCancelEdit = window.App.cancelEdit;
    window.App.cancelEdit = function () {
        originalCancelEdit();
        const switcher = document.getElementById('postUserSwitcher');
        if (switcher) switcher.remove();
    };

    function getPublishText() { return $('#publishText'); }
    function getPublishPreview() { return $('#publishPreview'); }
    function getCharCount() { return $('#charCount'); }
    function getBtnPublish() { return $('#btnPublish'); }

    function renderPublishPreview() {
        const $publishPreview = getPublishPreview();
        if (!$publishPreview) return;
        const files = window.App.publishFiles;
        // Live 组合（封面+短片，按 pairToken 配对）：预览只显示一张封面图，
        // 短片被“吸收”进封面里，不再单列一格（无论它们是否相邻）
        const clipIdxByToken = {};
        files.forEach(function (mf, i) {
            if (mf.type === 'video' && mf.live && mf.pairToken) clipIdxByToken[mf.pairToken] = i;
        });
        const skipped = {};
        let html = '';
        for (var i = 0; i < files.length; i++) {
            if (skipped[i]) continue;
            const mf = files[i];
            // 短片本身已被封面吸收
            if (mf.type === 'video' && mf.live && mf.pairToken && mf.pairToken in clipIdxByToken) {
                continue;
            }
            // Live 封面：合并显示（LIVE ▶ 角标），✕ 删除整组
            if (mf.type === 'image' && mf.live && mf.pairToken && clipIdxByToken[mf.pairToken] !== undefined) {
                const clipIdx = clipIdxByToken[mf.pairToken];
                skipped[clipIdx] = true;
                html += '<div class="publish-preview-item" data-remove="' + i + '" data-remove2="' + clipIdx + '">' +
                    '<img src="' + mf.previewUrl + '">' +
                    '<span class="media-type-badge">LIVE ▶</span>' +
                    '<button class="remove-btn">✕</button></div>';
                continue;
            }
            const badge = mf.type === 'video' ? '视频' : '';
            const inner = mf.type === 'video'
                ? '<video src="' + mf.previewUrl + '" muted></video>'
                : '<img src="' + mf.previewUrl + '">';
            html += '<div class="publish-preview-item" data-remove="' + i + '">' + inner +
                (badge ? '<span class="media-type-badge">' + badge + '</span>' : '') +
                '<button class="remove-btn">✕</button></div>';
        }
        $publishPreview.innerHTML = html;
        $publishPreview.querySelectorAll('.publish-preview-item').forEach(function (item) {
            item.querySelector('.remove-btn').onclick = function () {
                const idx = parseInt(item.dataset.remove);
                const idx2 = item.dataset.remove2 ? parseInt(item.dataset.remove2) : -1;
                const removed = idx2 > idx ? [idx, idx2] : [idx];
                // 从大到小删，保证序号有效（Live 组合整组删除）
                removed.sort(function (a, b) { return b - a; }).forEach(function (k) {
                    const it = window.App.publishFiles.splice(k, 1)[0];
                    if (it && !it.mediaId) URL.revokeObjectURL(it.previewUrl);
                });
                renderPublishPreview();
                updatePublishBtn();
            };
        });
    }

    function updatePublishBtn() {
        const $publishText = getPublishText();
        const $charCount = getCharCount();
        const $btnPublish = getBtnPublish();
        if (!$publishText || !$charCount || !$btnPublish) return;
        $charCount.textContent = $publishText.value.length + '/10000';
        $btnPublish.disabled = !$publishText.value.trim() && !window.App.publishFiles.length;
    }

    // ── Live 动图（模拟 Apple Live Photo 体验）──
    // 完全自动：选一张动态照片（jpg 内嵌 mp4）→ 自动拆出短片并按 Live 发布；
    // 静态图则和以前一样发普通图片，无需任何开关按钮。
    // 拆轨是异步的：把 Promise 挂在条目上，发布时若还没拆完会先等它，
    // 保证不会出现“只发了封面”或“发成图片+视频两段”的情况。
    function maybeAutoLiveFromMotion(entry) {
        if (!window.App.tryExtractMotionClip) return;
        if (!entry._extractPromise) entry._extractPromise = window.App.tryExtractMotionClip(entry.file);
        entry._extractPromise.then(function (clip) { applyMotionPair(entry, clip); });
    }

    // 把“封面 + 拆出的短片”合成一个 Live 条目（幂等：只补一次）
    // 封面与短片打上相同的 pairToken，多图混发/编辑中追加/先加普通图都不受影响
    function applyMotionPair(entry, clip) {
        if (!clip || entry._pairApplied) return;
        var now = window.App.publishFiles;
        // 封面已被移除则放弃（编辑中追加同样适用，token 会与帖子既有媒体并存）
        if (now.indexOf(entry) === -1) return;
        // 该封面已经有短片了（例如发布流程里先补过了）
        if (now.some(function (m) { return m.type === 'video' && m.pairToken && m.pairToken === entry.pairToken; })) return;
        entry._pairApplied = true;
        entry.live = true;
        entry.role = 'cover';
        if (!entry.pairToken) entry.pairToken = 'lp_' + Date.now() + Math.random().toString(36).slice(2, 6);
        now.push({ type: 'video', file: clip, previewUrl: URL.createObjectURL(clip), live: true, role: 'clip', autoMotion: true, pairToken: entry.pairToken });
        renderPublishPreview();
        updatePublishBtn();
    }

    // 统一入口：把用户选中的文件加入发布列表（图片可多选；视频只能一段）
    function addPublishFile(file, type) {
        if (!file || !type) return false;
        var files = window.App.publishFiles;
        if (type === 'image') {
            if (files.filter(function (m) { return m.type === 'image'; }).length >= 50) {
                window.App.showToast('最多' + 50 + '图片');
                return false;
            }
            var entry = { type: 'image', file: file, previewUrl: URL.createObjectURL(file) };
            files.push(entry);
            // 动态照片自动识别：jpg 内嵌 mp4 时自动拆出短片（像普通选图一样，无需开关）
            maybeAutoLiveFromMotion(entry);
            return true;
        }
        if (type === 'video') {
            if (files.some(function (m) { return m.type === 'video'; })) {
                window.App.showToast('已有视频');
                return false;
            }
            files.push({ type: 'video', file: file, previewUrl: URL.createObjectURL(file) });
            return true;
        }
        return false;
    }

    async function publish() {
        // 防重入：连点发布 / 回车+点击并发触发时，只允许一次真正执行
        if (window.App._publishing) return;
        const $publishText = getPublishText();
        if (!$publishText) return;
        const text = $publishText.value.trim();
        if (!text && !window.App.publishFiles.length) return;

        // 提前锁定本次发布用到的状态：避免等待媒体处理期间
        //（用户切账号/点取消/触发其他操作）导致编辑目标或文件列表变化
        var editId = window.App.editingPostId;
        var quality = parseFloat(($('#imgQuality') || { value: 0.9 }).value);

        window.App._publishing = true;
        var $btnPublish = getBtnPublish();
        if ($btnPublish) $btnPublish.disabled = true;
        try {
            // 动态照片拆轨是异步的：如果拆轨还没完成用户就点了发布（含编辑中追加），
            // 先等所有候选图片的拆轨结果并把组合补上，避免漏配/发成两段
            {
                var pendImgs = window.App.publishFiles.filter(function (m) {
                    return m.type === 'image' && m._extractPromise;
                });
                for (var pi = 0; pi < pendImgs.length; pi++) {
                    var pendClip = await pendImgs[pi]._extractPromise;
                    applyMotionPair(pendImgs[pi], pendClip);
                }
            }
            var files = window.App.publishFiles.slice();
            const imgIds = [],
                vidIds = [];
            for (var i = 0; i < files.length; i++) {
                var mf = files[i];
                if (mf.mediaId) { (mf.type === 'image' ? imgIds : vidIds).push(mf.mediaId); continue; }
                var mid = 'media_' + Date.now() + Math.random().toString(36).slice(2, 8);
                if (mf.type === 'image') {
                    var cblob = await window.App.compressImg(mf.file, 1500, quality);
                    await window.App.saveMedia(mid, cblob, 'image');
                    imgIds.push(mid);
                } else {
                    await window.App.saveMedia(mid, mf.file, 'video');
                    vidIds.push(mid);
                }
            }
            // 等待本批图片/短片上传云端完成（并行上传），统计失败数量
            var upResults = window.App.flushMediaUploads ? await window.App.flushMediaUploads() : [];
            var upFailCount = upResults.filter(function (r) { return !r; }).length;
            // 按 pairToken 还原 Live 配对（封面→短片），支持“1 张 Live + 若干普通图”混发
            //（封面、短片各自可能和其它图片/视频穿插，配对由 token 决定）
            var livePairs = [];
            var imageEntries = files.filter(function (m) { return m.type === 'image'; });
            var videoEntries = files.filter(function (m) { return m.type === 'video'; });
            files.forEach(function (mf) {
                if (mf.type !== 'image' || !mf.pairToken || !mf.live) return;
                var clipEntry = null;
                for (var vi = 0; vi < videoEntries.length; vi++) {
                    if (videoEntries[vi].pairToken === mf.pairToken && videoEntries[vi].live) {
                        clipEntry = videoEntries[vi];
                        break;
                    }
                }
                if (!clipEntry) return;
                var coverIdx = imageEntries.indexOf(mf);
                var clipIdx = videoEntries.indexOf(clipEntry);
                if (coverIdx < 0 || clipIdx < 0) return;
                livePairs.push({ cover: imgIds[coverIdx], clip: vidIds[clipIdx] });
            });
            var newPost = null;
            var savedPost = null;
            if (editId) {
                var post = window.App.posts.find(function (p) { return p.id === editId; });
                if (!post) throw new Error('post_missing');
                savedPost = post;
                var oldIds = [].concat(post.images || [], post.videos || []);
                // 保留原作者：AI帖子编辑后仍以AI身份保存
                post.userId = window.App.editingPostUserId || post.userId || window.App.currentId;
                window.App.editingPostUserId = null;
                post.text = text;
                post.images = imgIds;
                post.videos = vidIds;
                if (livePairs.length) { post.live = true; post.livePairs = livePairs; }
                else { delete post.live; delete post.livePairs; }
                var timeInput = $('#scheduleTime');
                if (timeInput && timeInput.value) post.timestamp = new Date(timeInput.value).getTime();
                // 编辑内容：标记脏数据，savePosts 内部会触发带时间戳保护的上传
                window.App.savePosts();
                for (var j = 0; j < oldIds.length; j++) {
                    var oid = oldIds[j];
                    if (imgIds.indexOf(oid) === -1 && vidIds.indexOf(oid) === -1) {
                        window.App.revokeMediaUrl(oid);
                        await window.App.deleteMedia(oid).catch(function () { });
                    }
                }
                window.App.editingPostId = null;
            } else {
                newPost = {
                    id: 'post_' + Date.now(), userId: window.App.editingPostUserId || window.App.currentId, text: text, images: imgIds, videos: vidIds,
                    timestamp: ($('#scheduleTime') || {}).value ? new Date($('#scheduleTime').value).getTime() : Date.now(), likes: [], comments: [], pinned: false
                };
                if (window.App._pendingGhost) {
                    newPost.ghostWriter = window.App._pendingGhost.writerId;
                    newPost.ghostInput  = window.App._pendingGhost.input;
                    delete window.App._pendingGhost;
                }
                if (livePairs.length) { newPost.live = true; newPost.livePairs = livePairs; }
                window.App.posts.push(newPost);
                savedPost = newPost;
                // 发布新内容：标记脏数据，savePosts 内部会触发带时间戳保护的上传
                window.App.savePosts();
            }
            // 数据已落盘：立即留“最近发布”快照兜底
            //（若之后发现这条动态没同步到云端/被冲掉，恢复条可一键找回）
            if (savedPost) recordLastPublished(savedPost);
            window.App.editingPostUserId = null;
            delete window.App._pendingGhost;
            // 清除发布者选择器
            var switcher = document.getElementById('postUserSwitcher');
            if (switcher) switcher.remove();
            // 先更新/插入卡片，全部成功后再清空发布框（中途出错则输入内容原样保留）
            if (editId) {
                window.App.updateCard(editId);
            } else {
                const $timeline = document.getElementById('timeline');
                if ($timeline && newPost) {
                    const emptyEl = $timeline.querySelector('.timeline-empty');
                    if (emptyEl) emptyEl.remove();
                    const div = document.createElement('div');
                    div.innerHTML = window.App.renderCard(newPost);
                    const card = div.firstElementChild;
                    const lastPinned = $timeline.querySelector('.pinned-card:last-of-type');
                    if (lastPinned) { lastPinned.after(card); } else { $timeline.prepend(card); }
                    window.App.observeMediaInContainer(card);
                    window.App.bindCardEvents();
                    window.App.renderedCount = (window.App.renderedCount || 0) + 1;
                }
            }
            for (var k = 0; k < files.length; k++) {
                if (!files[k].mediaId) URL.revokeObjectURL(files[k].previewUrl);
            }
            window.App.publishFiles = [];
            $publishText.value = '';
            $publishText.style.height = '';
            $publishText.style.overflowY = '';
            document.querySelector('.publish-area')?.classList.remove('expanded');
            var btnEx = document.getElementById('btnExpand');
            if (btnEx) { btnEx.textContent = '⌵'; btnEx.classList.remove('rotated'); btnEx.title = '展开'; btnEx.style.display = 'none'; }
            var st = $('#scheduleTime'); if (st) { st.style.display = 'none'; st.value = ''; }
            renderPublishPreview();
            updatePublishBtn();
            if ($btnPublish) $btnPublish.textContent = '发布';
            var $btnCancelEdit = $('#btnCancelEdit');
            if ($btnCancelEdit) $btnCancelEdit.style.display = 'none';
            // 发布真正成功：清掉输入草稿与“编辑前暂存”
            clearDraft();
            removeKeySafe(KEY_PRE);
            if (upFailCount > 0) {
                // 有媒体没传上云端：内容都在本地（含 IDB 里的图片），可点帖子下方的 [重传]
                window.App.showToast('⚠️ 有 ' + upFailCount + ' 个媒体上传云端失败，可在帖子下方点重传');
                if (window.App.setSyncStatus) {
                    window.App.setSyncStatus('warn', '⚠️ 有媒体未同步到云端，可在帖子下方点「重传」', null);
                }
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            if (e && e.message === 'post_missing') {
                // 编辑目标已不存在（例如刚被其他端同步删除）：保留输入内容，避免白写
                window.App.showToast('⚠️ 原帖子已不存在，本次修改未保存，内容仍保留在输入框');
            } else {
                console.error('发布失败:', e);
                window.App.showToast('❌ 发布失败，内容仍保留在输入框');
            }
        } finally {
            window.App._publishing = false;
            // 成功路径输入框已清空 → 恢复禁用；失败路径内容保留 → 按钮恢复可用，方便重试
            updatePublishBtn();
        }
    }

    function cancelEdit() {
        // 先取出“进入编辑前的正文”（若有），取消后放回发布框
        var preEdit = consumePreEdit();
        for (var i = 0; i < window.App.publishFiles.length; i++) {
            if (!window.App.publishFiles[i].mediaId) URL.revokeObjectURL(window.App.publishFiles[i].previewUrl);
        }
        window.App.publishFiles = [];
        window.App.renderPublishPreview();
        var $pt = $('#publishText'); if ($pt) { $pt.value = ''; $pt.style.height = ''; $pt.style.overflowY = ''; }
        document.querySelector('.publish-area')?.classList.remove('expanded');
        var btnEx = document.getElementById('btnExpand');
        if (btnEx) { btnEx.textContent = '⌵'; btnEx.classList.remove('rotated'); btnEx.title = '展开'; btnEx.style.display = 'none'; }
        var $st = $('#scheduleTime'); if ($st) { $st.style.display = 'none'; $st.value = ''; }
        window.App.editingPostId = null;
        window.App.editingPostUserId = null;
        delete window.App._pendingGhost;

        // 清除发布者选择器
        const switcher = document.getElementById('postUserSwitcher');
        if (switcher) switcher.remove();

        if (preEdit && preEdit.text && preEdit.text.trim()) {
            // 用户取消的是“编辑/代写”流程：把进入前的正文放回发布框继续写
            if ($pt) {
                $pt.value = preEdit.text;
                $pt.dispatchEvent(new Event('input', { bubbles: true }));
                $pt.focus({ preventScroll: true });
            }
        } else {
            // 真正放弃输入：清掉暂存草稿
            clearDraft();
        }

        updatePublishBtn();
        var $bp = getBtnPublish(); if ($bp) $bp.textContent = '发布';
        var $bce = $('#btnCancelEdit'); if ($bce) $bce.style.display = 'none';
    }
    window.App.cancelEdit = cancelEdit;

    window.App = window.App || {};
    window.App.publishFiles = window.App.publishFiles || [];
    window.App.renderPublishPreview = renderPublishPreview;
    window.App.updatePublishBtn = updatePublishBtn;
    window.App.publish = publish;
    window.App.renderPostUserSwitcher = renderPostUserSwitcher;

    // ════════════════════════════════════════════════════════════════
    // 草稿“安全网”：输入内容实时暂存到 localStorage（与帖子数据分离），
    // 发布成功/主动取消才清理；页面重开后自动提示一键恢复。
    // 同时记录“最近一次发布”快照，若发布后内容疑似未同步到云端可找回。
    // ════════════════════════════════════════════════════════════════
    var KEY_DRAFT = window.App.NS + 'draft_v1';
    var KEY_LAST_PUB = window.App.NS + 'last_pub_v1';
    var KEY_PUB_BACKUP = window.App.NS + 'pub_backup_v1';

    function readJSONSafe(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function writeJSONSafe(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { } }
    function removeKeySafe(key) { try { localStorage.removeItem(key); } catch (e) { } }

    var _draftTimer = null;

    // 进入“编辑帖子/AI代写/AI发帖”前的正文暂存（单槽，保留最早一次），
    // 取消编辑时会把这段正文放回发布框，避免“正在写的新内容被编辑流程吞掉”
    var KEY_PRE = window.App.NS + 'draft_pre_v1';
    function stashPreEdit() {
        var $pt = document.getElementById('publishText');
        if (!$pt) return;
        if (window.App.editingPostId) return;       // 已在编辑流程中，不重复暂存
        var text = $pt.value;
        if (!text.trim()) return;
        if (readJSONSafe(KEY_PRE)) return;          // 已有更早的暂存：保留最早一次
        writeJSONSafe(KEY_PRE, { text: text, ts: Date.now() });
    }
    function consumePreEdit() {
        var pre = readJSONSafe(KEY_PRE);
        removeKeySafe(KEY_PRE);
        return pre;
    }

    // 立即把当前输入框内容暂存为草稿（编辑状态/发布身份一并记录）
    function saveDraftNow() {
        var $pt = document.getElementById('publishText');
        if (!$pt) return;
        var text = $pt.value;
        // 输入框为空时不动已有草稿（只有发布成功/取消/用户主动丢弃才清理）
        if (!text.trim() && !(window.App.publishFiles && window.App.publishFiles.length)) return;
        writeJSONSafe(KEY_DRAFT, {
            text: text,
            ts: Date.now(),
            mode: window.App.editingPostId ? 'edit' : 'new',
            postId: window.App.editingPostId || null,
            userId: window.App.editingPostUserId || null,
            ghost: window.App._pendingGhost ? { writerId: window.App._pendingGhost.writerId, input: window.App._pendingGhost.input } : null
        });
    }
    function autosaveDraft(immediate) {
        if (immediate) { clearTimeout(_draftTimer); saveDraftNow(); return; }
        clearTimeout(_draftTimer);
        _draftTimer = setTimeout(saveDraftNow, 500);
    }
    function clearDraft() { clearTimeout(_draftTimer); removeKeySafe(KEY_DRAFT); }
    function getDraft() { return readJSONSafe(KEY_DRAFT); }

    // 帖子 → 可序列化快照（本地快照与发布备份共用同一结构）
    function snapshotOf(post) {
        return {
            postId: post.id,
            text: post.text || '',
            images: post.images || [],
            videos: post.videos || [],
            userId: post.userId || null,
            ghostWriter: post.ghostWriter || null,
            ghostInput: post.ghostInput || null,
            live: !!post.live,
            livePairs: (post.livePairs || []).map(function (p) { return { cover: p.cover, clip: p.clip }; }),
            ptime: post.timestamp || Date.now(),
            ts: Date.now()
        };
    }

    // 记录最近一次发布成功的快照（文本+媒体ID+身份+时间+Live配对），用于丢失找回
    function recordLastPublished(post) {
        if (!post) return;
        writeJSONSafe(KEY_LAST_PUB, snapshotOf(post));
        appendPublishBackup(post);
    }

    // ── 发布备份（本地留档，与同步机制完全隔离）──
    // 每次发布/编辑都把帖子内容写进本机 localStorage（最多 100 条），
    // 即使云端/同步出问题，也能从「发布备份」里恢复。
    function appendPublishBackup(post) {
        if (!post || !post.id) return;
        try {
            var list = getPublishBackups();
            var entry = snapshotOf(post);
            // 同 ID 覆盖（编辑后保留最新版本），最新的排最前
            list = list.filter(function (e) { return e && e.postId !== entry.postId; });
            list.unshift(entry);
            if (list.length > 100) list = list.slice(0, 100);
            try {
                localStorage.setItem(KEY_PUB_BACKUP, JSON.stringify(list));
            } catch (quotaErr) {
                // 空间不足：砍掉一半旧备份再写一次，保证新备份一定留得下
                list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
                try { localStorage.setItem(KEY_PUB_BACKUP, JSON.stringify(list)); } catch (e2) { }
            }
        } catch (e) { }
    }
    function getPublishBackups() {
        var list = readJSONSafe(KEY_PUB_BACKUP);
        return Array.isArray(list) ? list : [];
    }
    function clearPublishedSnapshot(postId) {
        var s = readJSONSafe(KEY_LAST_PUB);
        if (s && (!postId || s.postId === postId)) removeKeySafe(KEY_LAST_PUB);
    }

    // 输入时自动暂存（防抖 500ms）
    document.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'publishText') autosaveDraft(false);
    });

    // ── 恢复条 UI ──
    function timeAgoText(ts) {
        var m = Math.floor((Date.now() - (ts || 0)) / 60000);
        if (m < 1) return '刚刚';
        if (m < 60) return m + '分钟前';
        var h = Math.floor(m / 60);
        if (h < 24) return h + '小时前';
        return Math.floor(h / 24) + '天前';
    }
    function draftSnippet(t) {
        t = (t || '').replace(/\s+/g, ' ').trim();
        return t.length > 24 ? t.slice(0, 24) + '…' : t;
    }
    function removeRestoreBar() {
        var el = document.getElementById('draftRestoreBar');
        if (el) el.remove();
    }
    function baseBarHtml(title, snippetText, restoreLabel) {
        return '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 <b>' + window.App.escapeHtml(title) + '</b>：' + window.App.escapeHtml(snippetText) + '</span>' +
            '<button data-act="restore" style="flex-shrink:0;padding:4px 12px;font-size:12px;border-radius:8px;border:none;cursor:pointer;background:var(--accent,#7c5cfc);color:#fff;font-weight:600;">' + restoreLabel + '</button>' +
            '<button data-act="discard" style="flex-shrink:0;padding:4px 12px;font-size:12px;border-radius:8px;border:1px solid var(--border,#e6e9ef);cursor:pointer;background:transparent;color:var(--text-light,#888);">丢弃</button>';
    }
    function showBar(html, onRestore, onDiscard) {
        removeRestoreBar();
        var area = document.querySelector('.publish-area');
        if (!area) return;
        var bar = document.createElement('div');
        bar.id = 'draftRestoreBar';
        bar.style.cssText = 'display:flex;align-items:center;gap:10px;background:var(--card-bg,#fff);border:1px solid var(--border,#e6e9ef);border-radius:10px;padding:8px 12px;margin:8px 0 0;font-size:12px;color:var(--text,#333);box-shadow:0 2px 8px rgba(0,0,0,.06);z-index:5;';
        bar.innerHTML = html;
        bar.querySelector('[data-act="restore"]').onclick = function () { onRestore(); };
        bar.querySelector('[data-act="discard"]').onclick = function () { onDiscard(); removeRestoreBar(); };
        area.insertAdjacentElement('afterend', bar);
    }

    // 普通/AI/代写草稿 → 填回发布框继续编辑
    function restoreDraftIntoBox(d) {
        var $pt = document.getElementById('publishText');
        if (!$pt) return;
        $pt.value = d.text;
        window.App.editingPostId = null;
        window.App.editingPostUserId = d.userId || null;
        if (d.ghost) window.App._pendingGhost = { writerId: d.ghost.writerId, input: d.ghost.input };
        else delete window.App._pendingGhost;
        $pt.dispatchEvent(new Event('input', { bubbles: true }));
        var btn = document.getElementById('btnPublish');
        var cancel = document.getElementById('btnCancelEdit');
        var acc = d.userId ? window.App.getAcc(d.userId) : null;
        if (acc) {
            if (btn) btn.textContent = d.ghost ? '✍️ 以' + acc.nickname + '身份发布（AI代写）' : '以' + acc.nickname + '身份发布';
            if (cancel) cancel.style.display = '';
        }
        window.App.updatePublishBtn();
        $pt.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // 编辑模式草稿 → 重新进入原帖编辑（还原图片/视频/定时），再覆盖为草稿文字
    function restoreDraftAsEdit(d) {
        var $pt = document.getElementById('publishText');
        if (!$pt || !window.App.openEditModal) return;
        window.App.openEditModal(d.postId).then(function () {
            var ta = document.getElementById('publishText');
            if (ta) {
                ta.value = d.text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                window.App.updatePublishBtn();
            }
            // 草稿里记录的发布者（用户可能点过“切换”）优先于原帖作者
            window.App.editingPostUserId = d.userId || null;
            if (window.App.renderPostUserSwitcher) window.App.renderPostUserSwitcher();
        }).catch(function () {
            // 原帖已不存在：降级为普通文字草稿
            window.App.showToast('⚠️ 原帖已不存在，已按文字草稿恢复');
            restoreDraftIntoBox(d);
        });
    }
    // 把快照按“新动态”重新发布（丢失找回 / 从备份恢复共用）
    function republishSnapshot(snap, toastMsg) {
        var newPost = {
            id: 'post_r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            userId: snap.userId || window.App.currentId,
            text: snap.text || '',
            images: snap.images || [],
            videos: snap.videos || [],
            timestamp: snap.ptime || Date.now(),
            likes: [], comments: [], pinned: false
        };
        if (snap.ghostWriter) {
            newPost.ghostWriter = snap.ghostWriter;
            newPost.ghostInput = snap.ghostInput || null;
        }
        // 找回时还原 Live 配对（旧快照没有 livePairs 时按 1图1片 推导）
        if (snap.live) {
            newPost.live = true;
            var pairs = (snap.livePairs || []).filter(function (p) { return p && p.cover && p.clip; });
            if (!pairs.length && (snap.images || []).length === 1 && (snap.videos || []).length === 1) {
                pairs = [{ cover: snap.images[0], clip: snap.videos[0] }];
            }
            if (pairs.length) newPost.livePairs = pairs;
        }
        window.App.posts.unshift(newPost);
        window.App.savePosts();
        // 找回/恢复属于用户主动操作：强制上传，避免再次被时间戳比对跳过而同步不上去
        if (window.App.uploadToCloud) window.App.uploadToCloud(true);
        var $timeline = document.getElementById('timeline');
        if ($timeline) {
            var emptyEl = $timeline.querySelector('.timeline-empty');
            if (emptyEl) emptyEl.remove();
            var div = document.createElement('div');
            div.innerHTML = window.App.renderCard(newPost);
            var card = div.firstElementChild;
            var lastPinned = $timeline.querySelector('.pinned-card:last-of-type');
            if (lastPinned) { lastPinned.after(card); } else { $timeline.prepend(card); }
            window.App.observeMediaInContainer(card);
            window.App.bindCardEvents();
            window.App.renderedCount = (window.App.renderedCount || 0) + 1;
        }
        // 恢复出来的帖子同样纳入本地快照与备份，后续再出问题仍可找回
        recordLastPublished(newPost);
        window.App.showToast(toastMsg || '✅ 已重新发布');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 最近一次发布的动态疑似未同步 → 按新动态重新发布（媒体ID若还在即可恢复图片/视频）
    function restoreLostPublish(snap) {
        removeRestoreBar();
        republishSnapshot(snap, '✅ 已重新发布（若原帖稍后出现，可删掉其中一条）');
    }

    // 从发布备份里恢复任意一条
    function restorePublishBackup(postId) {
        var list = getPublishBackups();
        var entry = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].postId === postId) { entry = list[i]; break; }
        }
        if (!entry) { window.App.showToast('⚠️ 备份不存在'); return; }
        republishSnapshot(entry, '✅ 已从备份恢复发布（如原帖仍在，可删掉重复的一条）');
    }

    // 发布备份列表（侧边栏 / 设置菜单入口）
    function showPublishBackups() {
        var list = getPublishBackups();
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        var rows = '';
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            var text = (e.text || '').replace(/\s+/g, ' ').trim();
            var snippet = text ? (text.length > 34 ? text.slice(0, 34) + '…' : text) : '（图片/视频动态）';
            var mediaCount = (e.images || []).length + (e.videos || []).length;
            var when = new Date(e.ts || e.ptime || Date.now()).toLocaleString();
            var stillThere = (window.App.posts || []).some(function (p) { return p && p.id === e.postId; });
            rows += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">' +
                '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:11px;color:var(--text-light);">' + window.App.escapeHtml(when) +
                (mediaCount ? ' · ' + mediaCount + ' 个媒体' : '') +
                (stillThere ? ' · <span style="color:#27ae60;">仍在动态里</span>' : '') + '</div>' +
                '<div style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + window.App.escapeHtml(snippet) + '</div>' +
                '</div>' +
                '<button data-restore="' + window.App.escapeHtml(e.postId) + '" class="btn btn-save" style="flex-shrink:0;padding:5px 12px;font-size:12px;border-radius:8px;">恢复</button>' +
                '</div>';
        }
        if (!rows) rows = '<p style="text-align:center;color:var(--text-light);font-size:13px;margin:18px 0;">暂无发布备份</p>';
        overlay.innerHTML = '<div class="modal-dialog" style="max-width:460px;">' +
            '<h3>🗂️ 发布备份</h3>' +
            '<p style="font-size:12px;color:var(--text-light);margin:6px 0 10px;">每次发布/编辑都会在本机留档（最多 100 条），云端同步异常时可从这里恢复。</p>' +
            '<div style="max-height:50vh;overflow-y:auto;">' + rows + '</div>' +
            '<div class="btn-row" style="justify-content:center;margin-top:14px;">' +
            '<button class="btn btn-cancel" id="closePublishBackups">关闭</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#closePublishBackups').onclick = function () { overlay.remove(); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        overlay.querySelectorAll('[data-restore]').forEach(function (btn) {
            btn.onclick = function () {
                var id = btn.getAttribute('data-restore');
                overlay.remove();
                restorePublishBackup(id);
            };
        });
    }

    // 重新评估是否显示恢复条（本地数据就绪 / 云端初载完成 / 用户操作后调用）
    function refreshRestoreBar() {
        var $pt = document.getElementById('publishText');
        if (!$pt) return;
        removeRestoreBar();
        var busy = !!($pt.value.trim() || window.App.editingPostId ||
            (window.App.publishFiles && window.App.publishFiles.length));

        // 1) 未发布草稿
        var d = getDraft();
        if (!busy && d && d.text && d.text.trim()) {
            if (d.mode === 'edit' && d.postId) {
                var postExists = (window.App.posts || []).some(function (p) { return p.id === d.postId; });
                if (postExists) {
                    showBar(baseBarHtml('有未完成的编辑草稿（' + timeAgoText(d.ts) + '）', draftSnippet(d.text), '继续编辑'),
                        function () { removeRestoreBar(); restoreDraftAsEdit(d); },
                        clearDraft);
                    return;
                }
            }
            var acc = d.userId ? window.App.getAcc(d.userId) : null;
            showBar(baseBarHtml((acc ? '有以「' + acc.nickname + '」身份写的草稿（' + timeAgoText(d.ts) + '）' : '有未发布的草稿（' + timeAgoText(d.ts) + '）'), draftSnippet(d.text), '恢复'),
                function () { removeRestoreBar(); restoreDraftIntoBox(d); },
                clearDraft);
            return;
        }

        // 2) 最近一次发布的动态在本地数据里找不到 → 疑似被同步问题冲掉
        if (!busy) {
            var snap = readJSONSafe(KEY_LAST_PUB);
            var snapHasContent = snap && ((snap.text && snap.text.trim()) || (snap.images && snap.images.length) || (snap.videos && snap.videos.length));
            if (snap && snap.postId && snapHasContent) {
                var found = (window.App.posts || []).some(function (p) { return p.id === snap.postId; });
                if (!found) {
                    if (Date.now() - (snap.ts || 0) > 30 * 60 * 1000) {
                        // 超过半小时的旧记录自动作废，避免隔天误恢复导致重复
                        removeKeySafe(KEY_LAST_PUB);
                    } else {
                        showBar(baseBarHtml('上次发布的动态可能未保存成功（' + timeAgoText(snap.ts) + '）', (snap.text && snap.text.trim()) ? draftSnippet(snap.text) : '（图片/视频动态）', '↻ 重新发布'),
                            function () { restoreLostPublish(snap); },
                            function () { removeKeySafe(KEY_LAST_PUB); });
                    }
                }
            }
        }
    }

    // 防丢帖：最近一次发布的动态“本地有、云端快照没有”时返回 true。
    // 同步监听收到云端快照时用它判断是否该拒绝整体覆盖，避免刚发的帖子被当场吞掉。
    function shouldProtectLocalPosts(cloudPosts) {
        var snap = readJSONSafe(KEY_LAST_PUB);
        if (!snap || !snap.postId) return false;
        if (Date.now() - (snap.ts || 0) > 30 * 60 * 1000) return false;
        var localHas = (window.App.posts || []).some(function (p) { return p && p.id === snap.postId; });
        if (!localHas) return false;
        var cloudHas = (cloudPosts || []).some(function (p) { return p && p.id === snap.postId; });
        return !cloudHas;
    }

    // 公开接口 & 生命周期钩子（由 event.js 在本地/云端数据就绪后调用）
    window.App.autosaveDraft = autosaveDraft;
    window.App.clearDraft = clearDraft;
    window.App.stashPreEdit = stashPreEdit;
    window.App.consumePreEdit = consumePreEdit;
    window.App.refreshRestoreBar = refreshRestoreBar;
    window.App.clearPublishedSnapshot = clearPublishedSnapshot;
    window.App.recordLastPublished = recordLastPublished;
    window.App.shouldProtectLocalPosts = shouldProtectLocalPosts;
    window.App.getPublishBackups = getPublishBackups;
    window.App.showPublishBackups = showPublishBackups;
    window.App.restorePublishBackup = restorePublishBackup;
    window.App.onLocalDataReady = refreshRestoreBar;
    window.App.onCloudInitDone = refreshRestoreBar;
    window.App.addPublishFile = addPublishFile;
})();
