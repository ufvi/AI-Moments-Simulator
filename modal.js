(function () {
    const $ = (s) => document.querySelector(s);

    function editAccount(accId) {
        const acc = window.App.accounts.find(a => a.id === accId);
        if (!acc) return;
        window.App.closeAllDropdowns();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        // 临时背景色变量
        let tempAvatarBg = acc.avatarBg;

        overlay.innerHTML = `
        <div class="modal-dialog">
            <h3>${acc.isAI ? '🤖 编辑 AI 人设' : '编辑账号'}</h3>
            <label>昵称</label>
            <input type="text" id="editNickname" value="${window.App.escapeHtml(acc.nickname)}" maxlength="20">
            ${acc.isAI ? `<label>系统提示词</label>
            <textarea id="editSystemPrompt" rows="5" placeholder="说话风趣，带点俏皮...">${window.App.escapeHtml(acc.systemPrompt || '')}</textarea>
            <label>活跃度（随机模式下的被抽中概率权重）</label>
            <div class="activity-slider-row">
                <input type="range" id="editActivity" min="0" max="10" step="1" value="${acc.activity ?? 1}">
                <span class="activity-value" id="editActivityValue">${acc.activity ?? 1}</span>
            </div>
            <p class="activity-hint">设为 0 则不参与随机评论，数值越大被抽中概率越高</p>` : ''}
            <label>文字/Emoji 头像</label>
            <input type="text" id="editAvatarText" value="${window.App.escapeHtml(acc.avatarText || '')}" maxlength="2" placeholder="输入一个文字或emoji，如：猫、🐱、A" style="margin-top:4px;">
            <p class="hint-text">未设置图片头像时，显示此文字或emoji</p>
            <!-- ========== 新增：头像背景色 ========== -->
            <label>头像背景色</label>
            <input type="text" id="editAvatarBg" value="${acc.avatarBg}" placeholder="#3498db" style="margin-top:4px;">
            <div class="color-examples" id="avatarColorExamples">
                <span class="color-sample" style="background:#3498db" data-color="#3498db"></span>
                <span class="color-sample" style="background:#e74c3c" data-color="#e74c3c"></span>
                <span class="color-sample" style="background:#2ecc71" data-color="#2ecc71"></span>
                <span class="color-sample" style="background:#9b59b6" data-color="#9b59b6"></span>
                <span class="color-sample" style="background:#f39c12" data-color="#f39c12"></span>
                <span class="color-sample" style="background:#1abc9c" data-color="#1abc9c"></span>
                <span class="color-sample" style="background:#e67e22" data-color="#e67e22"></span>
                <span class="color-sample" style="background:#6c5ce7" data-color="#6c5ce7"></span>
                <span class="color-sample" style="background:#fd79a8" data-color="#fd79a8"></span>
                <span class="color-sample" style="background:#00b894" data-color="#00b894"></span>
                <span class="color-sample" style="background:#0984e3" data-color="#0984e3"></span>
                <span class="color-sample" style="background:#888" data-color="#888"></span>
            </div>
            <!-- ========== 新增结束 ========== -->
            <label>图片头像</label>
            <input type="file" id="editAvatarInput" accept="image/*" style="display:block;margin-top:4px;">
            <div class="builtin-avatar-list">
                <!-- ... 内置头像暂无 ... -->
            </div>
            <div id="editAvatarPreview" style="text-align:center;margin-top:6px;">
                ${(() => {
                if (acc.avatar?.startsWith('data:')) return `<img src="${acc.avatar}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border);">`;
                const t = acc.avatarText;
                if (t) return `<div style="width:64px;height:64px;border-radius:50%;background:${acc.avatarBg};display:flex;align-items:center;justify-content:center;font-size:${window.App.isEmoji(t) ? '32px' : '26px'};color:#fff;margin:0 auto;border:2px solid var(--border);">${window.App.escapeHtml(t)}</div>`;
                return `<div style="width:64px;height:64px;border-radius:50%;background:${acc.avatarBg};display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;margin:0 auto;border:2px solid var(--border);">${acc.nickname.charAt(0).toUpperCase()}</div>`;
            })()}
            </div>
            <p class="hint-text">选择新图片头像（可选），留空保持原头像</p>
            <!-- 徽章设置 -->
            <label>评论徽章文字</label>
            <input type="text" id="editBadgeText" value="${window.App.escapeHtml(acc.badgeText || '')}" maxlength="10" placeholder="留空则不显示">
            <label>徽章颜色</label>
            <input type="text" id="editBadgeColor" value="${acc.badgeColor || '#888'}" placeholder="#888">
            <div class="color-examples" id="badgeColorExamples">
                <span class="color-sample" style="background:#e74c3c" data-color="#e74c3c"></span>
                <span class="color-sample" style="background:#3498db" data-color="#3498db"></span>
                <span class="color-sample" style="background:#2ecc71" data-color="#2ecc71"></span>
                <span class="color-sample" style="background:#f39c12" data-color="#f39c12"></span>
                <span class="color-sample" style="background:#9b59b6" data-color="#9b59b6"></span>
                <span class="color-sample" style="background:#1abc9c" data-color="#1abc9c"></span>
                <span class="color-sample" style="background:#e67e22" data-color="#e67e22"></span>
                <span class="color-sample" style="background:#888" data-color="#888"></span>
            </div>
            <div class="btn-row">
                ${(window.App.accounts.length > 1 || (acc.isAI && window.App.accounts.some(a => !a.isAI))) ? `<button class="btn btn-danger" id="deleteAccountBtn">${acc.isAI ? '删除人设' : '删除账号'}</button>` : ''}
                <button class="btn btn-cancel" id="cancelEditBtn">取消</button>
                <button class="btn btn-save" id="saveEditBtn">保存</button>
            </div>
        </div>
    `;
        document.body.appendChild(overlay);

        // ===== 头像背景色交互 =====
        const $avatarBgInput = overlay.querySelector('#editAvatarBg');
        // 颜色示例点击
        overlay.querySelectorAll('#avatarColorExamples .color-sample').forEach(sample => {
            sample.addEventListener('click', function () {
                tempAvatarBg = this.dataset.color;
                $avatarBgInput.value = tempAvatarBg;
                updateAvatarPreview();
            });
        });
        // 输入框变化监听
        $avatarBgInput.addEventListener('input', function () {
            tempAvatarBg = this.value.trim() || '#3498db';
            updateAvatarPreview();
        });

        // 更新头像预览的辅助函数（复用原有的头像预览更新逻辑，但使用tempAvatarBg）
        function updateAvatarPreview() {
            const $preview = overlay.querySelector('#editAvatarPreview');
            if (tempAvatarText) {
                $preview.innerHTML = `<div style="width:64px;height:64px;border-radius:50%;background:${tempAvatarBg};display:flex;align-items:center;justify-content:center;font-size:${window.App.isEmoji(tempAvatarText) ? '32px' : '26px'};color:#fff;margin:0 auto;border:2px solid var(--border);">${window.App.escapeHtml(tempAvatarText)}</div>`;
            } else if (tempAvatar && tempAvatar.startsWith('data:')) {
                $preview.innerHTML = `<img src="${tempAvatar}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border);">`;
            } else {
                $preview.innerHTML = `<div style="width:64px;height:64px;border-radius:50%;background:${tempAvatarBg};display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;margin:0 auto;border:2px solid var(--border);">${acc.nickname.charAt(0).toUpperCase()}</div>`;
            }
        }

        // 徽章颜色示例（保持不变）
        overlay.querySelectorAll('#badgeColorExamples .color-sample').forEach(sample => {
            sample.addEventListener('click', function () {
                const colorInput = overlay.querySelector('#editBadgeColor');
                if (colorInput) {
                    colorInput.value = this.dataset.color;
                    colorInput.focus();
                }
            });
        });

        let tempAvatar = acc.avatar;
        let tempAvatarText = acc.avatarText || '';
        // 文字/Emoji头像实时预览（修改现有监听）
        const $avatarTextInput = overlay.querySelector('#editAvatarText');
        if ($avatarTextInput) {
            $avatarTextInput.addEventListener('input', function () {
                tempAvatarText = this.value.trim();
                updateAvatarPreview();
            });
        }
        // 内置头像点击
        overlay.querySelectorAll('.builtin-av').forEach(av => {
            av.addEventListener('click', function () {
                tempAvatar = this.dataset.uri;
                updateAvatarPreview();
            });
        });
        // 图片文件选择
        overlay.querySelector('#editAvatarInput').addEventListener('change', function () {
            const file = this.files[0];
            if (file) {
                window.App.compressImgToDataUrl(file, 200, 0.7, (dataUrl) => {
                    tempAvatar = dataUrl;
                    updateAvatarPreview();
                });
            }
        });

        // 活跃度滑块（保持不变）
        const activitySlider = overlay.querySelector('#editActivity');
        const activityValue = overlay.querySelector('#editActivityValue');
        if (activitySlider && activityValue) {
            activitySlider.addEventListener('input', function () {
                activityValue.textContent = this.value;
            });
        }

        overlay.querySelector('#cancelEditBtn').onclick = () => overlay.remove();
        overlay.querySelector('#saveEditBtn').onclick = () => {
            const newName = overlay.querySelector('#editNickname').value.trim();
            if (!newName) { window.App.showToast('昵称不能为空'); return; }
            acc.nickname = newName;
            acc.avatar = tempAvatar;
            acc.avatarText = tempAvatarText;
            // 保存背景色
            acc.avatarBg = tempAvatarBg;
            // 读取徽章设置
            acc.badgeText = overlay.querySelector('#editBadgeText').value.trim();
            acc.badgeColor = overlay.querySelector('#editBadgeColor').value.trim() || '#888';
            if (acc.isAI) {
                acc.systemPrompt = overlay.querySelector('#editSystemPrompt')?.value.trim() || '';
                acc.activity = parseInt(overlay.querySelector('#editActivity')?.value) ?? 1;
            }
            window.App.saveAccounts();
            overlay.remove();
            window.App.renderHeader();
            window.App.renderNormalDropdown();
            window.App.renderAIDropdown();
            window.App.renderTimeline(true);
            window.App.showToast('✅ 已更新');
        };
        const delBtn = overlay.querySelector('#deleteAccountBtn');
        if (delBtn) {
            delBtn.onclick = () => {
                overlay.remove();
                confirmDeleteAccount(accId);
            };
        }
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    function getBadgeHtml(account) {
        if (!account?.badgeText) return '';
        return `<span class="user-badge" style="background:${account.badgeColor || '#888'};color:#fff;">${window.App.escapeHtml(account.badgeText)}</span>`;
    }

    function confirmDeleteAccount(accId) {
        var acc = window.App.accounts.find(function (a) { return a.id === accId; });
        var name = acc ? acc.nickname : '该账号';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal-dialog modal-dialog-sm">' +
            '<h3 style="margin-bottom:8px;">' + (acc && acc.isAI ? '删除AI人设' : '删除账号') + '</h3>' +
            '<p style="text-align:center;font-size:14px;color:var(--text-light);margin:8px 0 16px;">确定删除 <b style="color:var(--text);">' + name + '</b> 吗？其动态将保留但显示为"未知用户"。</p>' +
            '<div class="btn-row" style="justify-content:center;gap:12px;">' +
            '<button class="btn btn-cancel" id="cancelDel">取消</button>' +
            '<button class="btn btn-danger" id="confirmDel">删除</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#cancelDel').onclick = () => overlay.remove();
        overlay.querySelector('#confirmDel').onclick = () => {
            window.App.accounts = window.App.accounts.filter(a => a.id !== accId);

            // 如果删光所有 AI 账号，清除当前选中的 AI
            if (window.App.activeAIId === accId || !window.App.accounts.some(a => a.isAI)) {
                window.App.activeAIId = null;
                localStorage.removeItem(window.App.KEY_ACTIVE_AI);
            }

            // 确保当前账号始终为普通账号（不会被 AI 账号顶替）
            if (window.App.currentId === accId) {
                let newAcc = window.App.accounts.find(a => !a.isAI);  // 优先选普通账号
                if (!newAcc) {
                    // 没有普通账号了，创建一个默认的
                    newAcc = {
                        id: 'acc_' + Date.now(),
                        nickname: '我',
                        avatar: '',
                        avatarText: '',
                        avatarBg: '#3498db',
                        createdAt: Date.now()
                    };
                    window.App.accounts.push(newAcc);
                }
                window.App.currentId = newAcc.id;
                localStorage.setItem(window.App.KEY_CUR, window.App.currentId);
            }

            // saveAccounts 内部已调用 markLocalDirty + uploadToCloud
            window.App.saveAccounts();

            overlay.remove();
            window.App.renderHeader();
            window.App.renderNormalDropdown();
            window.App.renderAIDropdown();
            window.App.renderTimeline(true);
            window.App.showToast('🗑️ 账号已删除');
        };
    }

    function addAIAccount() {
        window.App.closeAllDropdowns();
        const colors = ['#6c5ce7', '#e17055', '#00b894', '#0984e3', '#fd79a8', '#fdcb6e'];
        const id = 'acc_ai_' + Date.now();
        const newAI = {
            id,
            nickname: '未命名AI',          // 默认名称，用户会在编辑框中修改
            isAI: true,
            avatar: '',
            avatarText: '',
            avatarBg: colors[Math.floor(Math.random() * colors.length)],
            systemPrompt: '',
            badgeText: 'AI',
            badgeColor: '#888',
            activity: 1,                   // 活跃度（被随机抽中的概率权重），0=不参与
            createdAt: Date.now()
        };
        window.App.accounts.push(newAI);
        window.App.saveAccounts();               // 立即保存，以便 editAccount 能读取到
        window.App.activeAIId = id;
        localStorage.setItem(window.App.KEY_ACTIVE_AI, window.App.activeAIId);
        window.App.renderHeader();
        window.App.renderNormalDropdown();
        window.App.renderAIDropdown();
        // 直接打开编辑界面，完成编辑后即添加成功
        editAccount(id);
    }

    function addAccount() {
        const colors = ['#f5af19', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c'];
        window.App.accounts.push({
            id: 'acc_' + Date.now(),
            nickname: '新账号',
            avatar: '',
            avatarText: '',
            avatarBg: colors[Math.floor(Math.random() * colors.length)],
            badgeText: '',      // 新账号默认无徽章
            badgeColor: '#888',
            createdAt: Date.now()
        });
        window.App.saveAccounts();
        window.App.currentId = window.App.accounts[window.App.accounts.length - 1].id;
        localStorage.setItem(window.App.KEY_CUR, window.App.currentId);
        window.App.renderHeader();
        window.App.renderNormalDropdown();
        window.App.renderAIDropdown();
        window.App.renderTimeline(true);
    }

    async function openEditModal(id) {
        const post = window.App.posts.find(p => p.id === id);
        if (!post) return;
        // 进入编辑前，先暂存发布框里正在写的内容（取消编辑时自动放回）
        if (window.App.stashPreEdit) window.App.stashPreEdit();
        // Live 帖：解析配对（新格式 livePairs；旧格式 live+单图单片 推导），
        // 加载媒体时给封面/短片打上相同的 pairToken，保存时保持配对
        const livePairs = (Array.isArray(post.livePairs) && post.livePairs.length)
            ? post.livePairs
            : ((post.live && (post.images || []).length === 1 && (post.videos || []).length === 1)
                ? [{ cover: (post.images || [])[0], clip: (post.videos || [])[0] }]
                : []);
        const tokenByMid = {};
        livePairs.forEach((p, i) => {
            const t = 'lpe_' + i + '_' + post.id;
            if (p && p.cover) tokenByMid[p.cover] = t;
            if (p && p.clip) tokenByMid[p.clip] = t;
        });
        window.App.editingPostId = id;
        window.App.editingPostUserId = post.userId;
        const $pt = document.querySelector('#publishText');
        $pt.value = post.text || '';
        $pt.dispatchEvent(new Event('input', { bubbles: true }));
        window.App.publishFiles = [];
        for (const mid of [...(post.images || []), ...(post.videos || [])]) {
            var blob = null;
            var isVideo = (post.videos || []).indexOf(mid) !== -1;
            var type = isVideo ? 'video' : 'image';
            try {
                var rec = await window.App.getMedia(mid);
                if (rec && rec.blob) { blob = rec.blob; type = rec.type || type; }
            } catch (e) { }
            if (!blob && window._fbDownloadMedia) {
                try { blob = await window._fbDownloadMedia(mid); } catch (e) { }
            }
            if (!blob) {
                try {
                    var u = await window.App.loadMediaUrl(mid);
                    if (u) { var resp = await fetch(u); if (resp.ok) blob = await resp.blob(); }
                } catch (e) { }
            }
            if (blob) {
                var entry = { type: type, file: blob, previewUrl: URL.createObjectURL(blob), mediaId: mid };
                if (tokenByMid[mid]) {
                    entry.live = true;
                    entry.pairToken = tokenByMid[mid];
                    entry.role = isVideo ? 'clip' : 'cover';
                }
                window.App.publishFiles.push(entry);
            }
        }
        const timeInput = document.querySelector('#scheduleTime');
        timeInput.style.display = 'inline-block';
        const d = new Date(post.timestamp);
        const pad = (n) => n.toString().padStart(2, '0');
        timeInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        window.App.renderPublishPreview();
        window.App.updatePublishBtn();
        document.querySelector('#btnCancelEdit').style.display = '';
        document.querySelector('#btnPublish').textContent = '保存修改';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.querySelector('#publishText').focus();

        window.App.renderPostUserSwitcher();
        const acc = window.App.getAcc(window.App.editingPostUserId);
        const btnPublish = document.getElementById('btnPublish');
        if (acc && acc.id !== window.App.currentId) {
            btnPublish.textContent = `以${acc.nickname}身份发布`;
        } else {
            btnPublish.textContent = '保存修改';
        }
    }

    function confirmDelete(id) {
        var overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.innerHTML =
            '<div class="modal-dialog modal-dialog-sm">' +
            '<h3 style="margin-bottom:8px;">删除动态</h3>' +
            '<p style="text-align:center;font-size:14px;color:var(--text-light);margin:8px 0 16px;">确定删除这条动态吗？删除后无法恢复。</p>' +
            '<div class="btn-row" style="justify-content:center;gap:12px;">' +
            '<button class="btn btn-cancel" id="cancelDelPost">取消</button>' +
            '<button class="btn btn-danger" id="confirmDelPost">删除</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector("#cancelDelPost").onclick = function () { overlay.remove(); };
        overlay.querySelector("#confirmDelPost").onclick = async function () {
            overlay.remove();
            var post = window.App.posts.find(function (p) { return p.id === id; });
            if (post) {
                var mids = (post.images || []).concat(post.videos || []);
                for (var i = 0; i < mids.length; i++) {
                    window.App.revokeMediaUrl(mids[i]);
                    await window.App.deleteMedia(mids[i]).catch(function () { });
                }
            }
            window.App.posts = window.App.posts.filter(function (p) { return p.id !== id; });
            // 删除的是“最近发布”快照对应的帖子时，同步清掉快照，避免之后误提示“发布丢失”
            if (window.App.clearPublishedSnapshot) window.App.clearPublishedSnapshot(id);
            // savePosts 内部已调用 markLocalDirty + uploadToCloud
            window.App.savePosts();
            var card = document.getElementById('post-' + id);
            if (card) card.remove();
            window.App.renderedCount = Math.max(0, (window.App.renderedCount || 0) - 1);
            const $timeline = document.getElementById('timeline');
            if ($timeline && !$timeline.querySelector('.post-card') && (!$timeline.querySelector('.timeline-empty'))) {
                $timeline.innerHTML = '<div class="timeline-empty"><span class="empty-icon">🌱</span><p>还没有动态</p></div>';
                window.App.renderedCount = 0;
            }
        };
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    }

    // 图片大图预览：当浏览到 Live 封面时，自动播放一遍它的短片（播完回到封面）
    let _modalLiveSeq = 0;
    function clearModalLiveVideo() {
        _modalLiveSeq++;
        const el = document.querySelector('#imageModal .image-modal-live-video');
        if (el) el.remove();
        const img = document.getElementById('imageModalImg');
        if (img) img.style.display = '';
    }
    function currentModalLiveClip() {
        const d = window.App.modalData;
        if (!d || !d.postId || !window.App.resolveLivePairs) return null;
        const cur = d.entries[d.currentIndex];
        if (!cur || !cur.id) return null;
        const post = (window.App.posts || []).find(p => p.id === d.postId);
        if (!post) return null;
        const pairs = window.App.resolveLivePairs(post);
        for (let i = 0; i < pairs.length; i++) {
            if (pairs[i].cover === cur.id) return pairs[i].clip;
        }
        return null;
    }
    function playModalLiveClip(clipMid) {
        const seq = ++_modalLiveSeq;
        window.App.loadMediaUrl(clipMid).then(url => {
            if (!url || seq !== _modalLiveSeq) return;
            const img = document.getElementById('imageModalImg');
            const wrap = img ? img.parentElement : null;
            if (!wrap) return;
            const old = wrap.querySelector('.image-modal-live-video');
            if (old) old.remove();
            img.style.display = 'none';
            const v = document.createElement('video');
            v.className = 'image-modal-live-video';
            v.src = url;
            v.autoplay = true;
            v.playsInline = true;
            v.setAttribute('webkit-playsinline', '');
            v.controls = true;
            v.preload = 'auto';
            const finish = function () {
                if (seq !== _modalLiveSeq) return;
                const cur = wrap.querySelector('.image-modal-live-video');
                if (cur === v) cur.remove();
                img.style.display = '';
            };
            v.addEventListener('ended', finish);
            wrap.appendChild(v);
            const p = v.play();
            if (p && p.catch) p.catch(function () {
                // iOS：异步加载后有声播放常被拦 → 无声自动播一遍，用户可点控制条出声
                v.muted = true;
                const p2 = v.play();
                if (p2 && p2.catch) p2.catch(function () { });
            });
        });
    }

    // 手机端：在图片上左右滑动切换上一张/下一张
    function bindModalSwipe() {
        const modal = document.querySelector('#imageModal');
        if (!modal || modal._swipeBound) return;
        modal._swipeBound = true;
        let sx = null, sy = null;
        modal.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) { sx = null; return; }
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
        }, { passive: true });
        modal.addEventListener('touchmove', function (e) {
            if (sx === null || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - sx;
            const dy = e.touches[0].clientY - sy;
            // 明显的横向滑动：阻止浏览器把它当成系统手势（如返回上一页）
            if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 1.2 && e.cancelable) {
                e.preventDefault();
            }
        }, { passive: false });
        modal.addEventListener('touchend', function (e) {
            if (sx === null) return;
            const t = e.changedTouches && e.changedTouches[0];
            const dx = t ? t.clientX - sx : 0;
            const dy = t ? t.clientY - sy : 0;
            sx = null;
            if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) {
                // 在播放视频上滑动可能是在拖进度条，不触发翻页
                const target = e.target && e.target.closest ? e.target.closest('video') : null;
                if (!target) window.App.navImage(dx < 0 ? 1 : -1);
            }
        }, { passive: true });
    }

    function openImageModal(ids, idx, postId) {
        Promise.all(ids.map(window.App.loadMediaUrl)).then(urls => {
            const entries = [];
            ids.forEach((mid, i) => {
                if (urls[i]) entries.push({ id: mid, url: urls[i] });
            });
            if (!entries.length) return;
            window.App.modalData = {
                entries: entries,
                currentIndex: Math.max(0, Math.min(idx || 0, entries.length - 1)),
                postId: postId || null
            };
            updateImageModal();
            bindModalSwipe();
            document.querySelector('#imageModal').style.display = 'flex';
        });
    }

    function updateImageModal() {
        if (!window.App.modalData) return;
        const e = window.App.modalData.entries[window.App.modalData.currentIndex];
        if (!e) return;
        document.querySelector('#imageModalImg').src = e.url;
        document.querySelector('#imageModalCounter').textContent = `${window.App.modalData.currentIndex + 1}/${window.App.modalData.entries.length}`;
        document.querySelector('#imageModalPrev').style.display = window.App.modalData.currentIndex > 0 ? '' : 'none';
        document.querySelector('#imageModalNext').style.display = window.App.modalData.currentIndex < window.App.modalData.entries.length - 1 ? '' : 'none';
        // 当前是 Live 封面：点封面可重播；进入/翻到该页时自动播放一遍（放完回到封面）
        clearModalLiveVideo();
        const clip = currentModalLiveClip();
        const imgEl = document.querySelector('#imageModalImg');
        if (imgEl) imgEl.onclick = null;
        if (clip) {
            if (imgEl) {
                imgEl.onclick = function () { clearModalLiveVideo(); playModalLiveClip(clip); };
            }
            playModalLiveClip(clip);
        }
    }

    function closeImageModal() {
        clearModalLiveVideo();
        document.querySelector('#imageModal').style.display = 'none';
        window.App.modalData = null;
    }

    function navImage(dir) {
        if (window.App.modalData) {
            const n = window.App.modalData.currentIndex + dir;
            if (n >= 0 && n < window.App.modalData.entries.length) {
                window.App.modalData.currentIndex = n;
                updateImageModal();
            }
        }
    }

    function showToast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2000);
    }

    function showToastBottom(msg) {
        const t = document.createElement('div');
        t.className = 'toast toast-bottom';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2000);
    }

    let activeProgressToast = null;
    let progressBarEl = null;

    function showProgress(msg) {
        if (!activeProgressToast) {
            activeProgressToast = document.createElement('div');
            activeProgressToast.className = 'toast toast-progress';
            activeProgressToast.style.animation = 'none';
            activeProgressToast.innerHTML = '<span class="toast-progress-text"></span><div class="toast-progress-track"><div class="toast-progress-bar"></div></div>';
            progressBarEl = activeProgressToast.querySelector('.toast-progress-bar');
            document.body.appendChild(activeProgressToast);
        }
        activeProgressToast.querySelector('.toast-progress-text').textContent = msg;
    }

    function showUploadProgress(loaded, total) {
        const pct = Math.min(Math.round(loaded / total * 100), 100);
        if (!activeProgressToast) {
            showProgress('☁️ 上传中 0%');
        }
        activeProgressToast.querySelector('.toast-progress-text').textContent = `☁️ 上传中 ${pct}%`;
        if (progressBarEl) {
            progressBarEl.style.width = pct + '%';
        }
    }

    function hideProgress() {
        if (activeProgressToast) {
            activeProgressToast.remove();
            activeProgressToast = null;
            progressBarEl = null;
        }
    }

    window.App = window.App || {};
    window.App.editAccount = editAccount;
    window.App.getBadgeHtml = getBadgeHtml;
    window.App.confirmDeleteAccount = confirmDeleteAccount;
    window.App.addAIAccount = addAIAccount;
    window.App.addAccount = addAccount;
    window.App.openEditModal = openEditModal;
    window.App.confirmDelete = confirmDelete;
    window.App.openImageModal = openImageModal;
    window.App.updateImageModal = updateImageModal;
    window.App.closeImageModal = closeImageModal;
    window.App.navImage = navImage;
    window.App.showToast = showToast;
    window.App.showToastBottom = showToastBottom;
    window.App.showProgress = showProgress;
    window.App.showUploadProgress = showUploadProgress;
    window.App.hideProgress = hideProgress;
    window.App.modalData = null;
})();
