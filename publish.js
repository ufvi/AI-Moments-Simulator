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
            if (a.avatarText) {
                avHtml = `<div class="avatar-placeholder-sm" style="background:${a.avatarBg};font-size:${window.App.isEmoji(a.avatarText) ? '18px' : '12px'}">${window.App.escapeHtml(a.avatarText)}</div>`;
            } else if (a.avatar?.startsWith('data:')) {
                avHtml = `<img class="avatar-sm" src="${a.avatar}">`;
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
        $publishPreview.innerHTML = window.App.publishFiles.map((mf, i) =>
            '<div class="publish-preview-item">' + (mf.type === 'video' ? '<video src="' + mf.previewUrl + '" muted></video><span class="media-type-badge">视频</span>' : '<img src="' + mf.previewUrl + '">') + '<button class="remove-btn" data-remove="' + i + '">✕</button></div>'
        ).join('');
        document.querySelectorAll('#publishPreview .remove-btn').forEach(function (b) {
            b.onclick = function () {
                var idx = parseInt(this.dataset.remove);
                var mf = window.App.publishFiles.splice(idx, 1)[0];
                if (!mf.mediaId) URL.revokeObjectURL(mf.previewUrl);
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
        $charCount.textContent = $publishText.value.length + '/2000';
        $btnPublish.disabled = !$publishText.value.trim() && !window.App.publishFiles.length;
    }

    async function publish() {
        const $publishText = getPublishText();
        if (!$publishText) return;
        const text = $publishText.value.trim();
        if (!text && !window.App.publishFiles.length) return;
        const quality = parseFloat(($('#imgQuality') || { value: 0.9 }).value);
        const imgIds = [],
            vidIds = [];
        for (var i = 0; i < window.App.publishFiles.length; i++) {
            var mf = window.App.publishFiles[i];
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
        var editId = window.App.editingPostId;
        if (editId) {
            var post = window.App.posts.find(function (p) { return p.id === editId; });
            if (post) {
                var oldIds = [].concat(post.images || [], post.videos || []);
                // 保留原作者：AI帖子编辑后仍以AI身份保存
                post.userId = window.App.editingPostUserId || post.userId || window.App.currentId;
                window.App.editingPostUserId = null;
                post.text = text;
                post.images = imgIds;
                post.videos = vidIds;
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
            }
            window.App.editingPostId = null;
        } else {
            window.App.posts.push({
                id: 'post_' + Date.now(), userId: window.App.editingPostUserId || window.App.currentId, text: text, images: imgIds, videos: vidIds,
                timestamp: ($('#scheduleTime') || {}).value ? new Date($('#scheduleTime').value).getTime() : Date.now(), likes: [], comments: [], pinned: false
            });
            // 发布新内容：标记脏数据，savePosts 内部会触发带时间戳保护的上传
            window.App.savePosts();
        }
        window.App.editingPostUserId = null;
        for (var k = 0; k < window.App.publishFiles.length; k++) {
            if (!window.App.publishFiles[k].mediaId) URL.revokeObjectURL(window.App.publishFiles[k].previewUrl);
        }
        window.App.publishFiles = [];
        $publishText.value = '';
        var st = $('#scheduleTime'); if (st) { st.style.display = 'none'; st.value = ''; }
        renderPublishPreview();
        updatePublishBtn();
        var $btnPublish = getBtnPublish();
        if ($btnPublish) $btnPublish.textContent = '发布';
        var $btnCancelEdit = $('#btnCancelEdit');
        if ($btnCancelEdit) $btnCancelEdit.style.display = 'none';
        window.App.renderTimeline(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function cancelEdit() {
        for (var i = 0; i < window.App.publishFiles.length; i++) {
            if (!window.App.publishFiles[i].mediaId) URL.revokeObjectURL(window.App.publishFiles[i].previewUrl);
        }
        window.App.publishFiles = [];
        var $pt = $('#publishText'); if ($pt) $pt.value = '';
        var $st = $('#scheduleTime'); if ($st) { $st.style.display = 'none'; $st.value = ''; }
        window.App.editingPostId = null;
        window.App.editingPostUserId = null;

        // 清除发布者选择器
        const switcher = document.getElementById('postUserSwitcher');
        if (switcher) switcher.remove();

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
})();
