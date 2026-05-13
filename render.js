(function () {
    const $ = (s) => document.querySelector(s);
    let searchActive = false;
    const PAGE_SIZE = 10;
    let renderedCount = 0;
    let allPostsRendered = false;
    const COMMENT_COLLAPSE_THRESHOLD = 3;
    const expandedPosts = new Set();

    function renderHeader() {
        const $headerAvatar = $('#headerAvatar');
        const $headerNickname = $('#headerNickname');
        if (!$headerAvatar || !$headerNickname) return;

        const acc = window.App.getCurAcc();
        if (!acc) {
            $headerAvatar.innerHTML =
                '<div class="header-avatar-placeholder" style="background:#ccc;">?</div>';
            $headerNickname.textContent = '未登录';
        } else {
            if (acc.avatarText) {
                $headerAvatar.innerHTML =
                    `<div class="header-avatar-placeholder" style="background:${acc.avatarBg};font-size:${window.App.isEmoji(acc.avatarText) ? '20px' : '15px'}">${window.App.escapeHtml(acc.avatarText)}</div>`;
            } else if (acc.avatar && acc.avatar.startsWith('data:')) {
                $headerAvatar.innerHTML =
                    `<img class="header-avatar" src="${acc.avatar}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="header-avatar-placeholder" style="display:none;background:${acc.avatarBg}">${acc.nickname.charAt(0).toUpperCase()}</div>`;
            } else {
                $headerAvatar.innerHTML =
                    `<div class="header-avatar-placeholder" style="background:${acc.avatarBg}">${acc.nickname.charAt(0).toUpperCase()}</div>`;
            }
            $headerNickname.textContent = acc.nickname;
        }

        const $headerAIName = $('#headerAIName');
        const $headerAIArea = $('#headerAIArea');
        if ($headerAIName) {
            const aiAcc = window.App.activeAIId ? window.App.getAcc(window.App.activeAIId) : null;
            $headerAIName.textContent = window.App.randomAIMode ? '🎲 随机' : (aiAcc ? aiAcc.nickname : 'AI');
        }
        if ($headerAIArea) {
            $headerAIArea.classList.toggle('random-mode', window.App.randomAIMode);
        }

        // 同步渲染侧边栏用户区
        const $sidebarUserArea = $('#sidebarUserArea');
        if ($sidebarUserArea) {
            let sbAvHtml;
            if (!acc) {
                sbAvHtml = '<div class="header-avatar-placeholder" style="background:#ccc;">?</div>';
            } else if (acc.avatarText) {
                sbAvHtml = '<div class="header-avatar-placeholder" style="background:' + acc.avatarBg + ';font-size:' + (window.App.isEmoji(acc.avatarText) ? '20px' : '15px') + '">' + window.App.escapeHtml(acc.avatarText) + '</div>';
            } else if (acc.avatar && acc.avatar.startsWith('data:')) {
                sbAvHtml = '<img class="header-avatar" src="' + acc.avatar + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
                    '<div class="header-avatar-placeholder" style="display:none;background:' + acc.avatarBg + '">' + acc.nickname.charAt(0).toUpperCase() + '</div>';
            } else {
                sbAvHtml = '<div class="header-avatar-placeholder" style="background:' + (acc ? acc.avatarBg : '#ccc') + '">' + (acc ? acc.nickname.charAt(0).toUpperCase() : '?') + '</div>';
            }
            $sidebarUserArea.innerHTML = sbAvHtml +
                '<span class="header-nickname">' + window.App.escapeHtml(acc ? acc.nickname : '未登录') + '</span>' +
                '<span class="header-arrow">▾</span>';
        }

        // 同步渲染右侧栏 AI 列表
        renderSidebarAIList();
    }

    function renderSidebarAIList() {
        var container = document.getElementById('sidebarAIList');
        if (!container) return;

        var aiAccounts = window.App.accounts.filter(function (a) { return a.isAI; });

        // 语录卡片可见性
        var quoteSection = document.getElementById('quoteSection');
        if (quoteSection) {
            quoteSection.classList.toggle('no-ai', !aiAccounts || aiAccounts.length === 0);
        }

        if (!aiAccounts || aiAccounts.length === 0) {
            container.innerHTML = '<div style="font-size:12px;color:var(--text-light);padding:8px;">暂无 AI 账号</div>';
            return;
        }

        var html = '';

        // 随机 AI 模式开关
        html += '<div class="random-ai-toggle-row' + (window.App.randomAIMode ? ' active' : '') + '" id="sidebarRandomAIToggle">' +
            '<span class="toggle-label"><span class="dice-icon">🎲</span> 随机AI模式</span>' +
            '<div class="toggle-switch' + (window.App.randomAIMode ? ' active' : '') + '" id="sidebarRandomAIToggleSwitch"></div>' +
            '</div>';

        // AI 账号列表
        aiAccounts.forEach(function (a) {
            var isActive = a.id === window.App.activeAIId;
            var aiAvText = a.avatarText || '🤖';
            var aiAvIsEmoji = window.App.isEmoji(aiAvText);
            var act = a.activity ?? 1;
            html += '<div class="sidebar-ai-account-item' + (isActive ? ' active' : '') + '" data-ai-id="' + a.id + '">' +
                '<div class="avatar-placeholder-sm" style="background:' + a.avatarBg + ';font-size:' + (aiAvIsEmoji ? '18px' : '13px') + ';flex-shrink:0;">' + window.App.escapeHtml(aiAvText) + '</div>' +
                '<span class="sidebar-ai-account-name">' + window.App.escapeHtml(a.nickname) + '</span>' +
                (isActive ? '<span class="sidebar-ai-check">✓</span>' : '') +
                '<span class="account-dropdown-edit" data-action="edit-ai" data-account-id="' + a.id + '">✎</span>' +
                '</div>';
        });

        html += '<div class="account-dropdown-add" id="sidebarAddAIAccount" style="color:var(--ai-purple);">+ 添加 AI 人设</div>';

        container.innerHTML = html;

        // "添加 AI 人设" 按钮
        var addBtn = document.getElementById('sidebarAddAIAccount');
        if (addBtn) {
            addBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                window.App.addAIAccount();
            });
        }

        // 随机模式开关事件
        var toggleRow = document.getElementById('sidebarRandomAIToggle');
        var toggleSwitch = document.getElementById('sidebarRandomAIToggleSwitch');
        var toggleRandom = function () {
            window.App.randomAIMode = !window.App.randomAIMode;
            localStorage.setItem(window.App.KEY_RANDOM_AI, window.App.randomAIMode);
            renderHeader();
            window.App.showToastBottom(window.App.randomAIMode ? '🎲 随机AI模式已开启' : '🎲 随机AI模式已关闭');
        };
        if (toggleRow) toggleRow.addEventListener('click', function (e) { e.stopPropagation(); toggleRandom(); });
        if (toggleSwitch) toggleSwitch.addEventListener('click', function (e) { e.stopPropagation(); toggleRandom(); });

        // AI 账号切换 / 编辑事件
        container.querySelectorAll('[data-ai-id]').forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                if (e.target.dataset.action === 'edit-ai') {
                    window.App.editAccount(e.target.dataset.accountId);
                    return;
                }
                window.App.activeAIId = item.dataset.aiId;
                localStorage.setItem(window.App.KEY_ACTIVE_AI, window.App.activeAIId);
                window.App.showToastBottom('🤖 已切换：' + (window.App.getAcc(window.App.activeAIId)?.nickname || 'AI'));
                renderHeader();
                renderAIDropdown();
            });
        });
    }

    function closeAllDropdowns() {
        const $normalDropdown = $('#normalDropdown');
        const $aiDropdown = $('#aiDropdown');
        const $settingsDropdown = $('#settingsDropdown');
        if ($normalDropdown) $normalDropdown.style.display = 'none';
        if ($aiDropdown) $aiDropdown.style.display = 'none';
        if ($settingsDropdown) $settingsDropdown.style.display = 'none';
    }

    function renderNormalDropdown() {
        const $normalDropdown = $('#normalDropdown');
        if (!$normalDropdown) return;

        const normal = window.App.accounts.filter(a => !a.isAI);

        // 统计发帖数量
        const postCounts = {};
        normal.forEach(a => { postCounts[a.id] = 0; });
        window.App.posts.forEach(p => {
            if (postCounts[p.userId] !== undefined) {
                postCounts[p.userId]++;
            }
        });

        // 按发帖数从高到低排序
        const sorted = [...normal].sort((a, b) => (postCounts[b.id] || 0) - (postCounts[a.id] || 0));

        let html = `<div style="padding:6px 14px 4px;font-size:11px;color:var(--text-light);font-weight:600;letter-spacing:.5px;">👤 普通账号</div>`;
        html += sorted.map(a => {
            const isActive = a.id === window.App.currentId;
            const postCount = postCounts[a.id] || 0;
            let avHtml;
            if (a.avatarText) {
                avHtml = `<div class="avatar-placeholder-sm" style="background:${a.avatarBg};font-size:${window.App.isEmoji(a.avatarText) ? '18px' : '12px'}">${window.App.escapeHtml(a.avatarText)}</div>`;
            } else if (a.avatar?.startsWith('data:')) {
                avHtml = `<img class="avatar-sm" src="${a.avatar}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="avatar-placeholder-sm" style="display:none;background:${a.avatarBg}">${a.nickname.charAt(0).toUpperCase()}</div>`;
            } else {
                avHtml = `<div class="avatar-placeholder-sm" style="background:${a.avatarBg}">${a.nickname.charAt(0).toUpperCase()}</div>`;
            }
            return `<div class="account-dropdown-item${isActive ? ' active' : ''}" data-account-id="${a.id}">
            ${avHtml}
            <span>${window.App.escapeHtml(a.nickname)}</span>
            <span style="margin-left:auto;color:var(--text-light);font-size:11px;white-space:nowrap;">${postCount}条动态</span>
            ${isActive ? '<span class="check-mark">✓</span>' : ''}
            <span class="account-dropdown-edit" data-action="edit" data-account-id="${a.id}">✎</span>
        </div>`;
        }).join('');
        html += '<div class="account-dropdown-add" id="btnAddAccount">+ 添加新账号</div>';
        $normalDropdown.innerHTML = html;
    }

    function renderAIDropdown() {
        const $aiDropdown = $('#aiDropdown');
        if (!$aiDropdown) return;

        const aiAccounts = window.App.accounts.filter(a => a.isAI);
        const aiCommentCounts = {};
        aiAccounts.forEach(a => { aiCommentCounts[a.id] = 0; });
        window.App.posts.forEach(p => {
            p.comments.forEach(c => {
                if (aiCommentCounts[c.userId] !== undefined) {
                    aiCommentCounts[c.userId]++;
                }
            });
        });

        // 按评论条数从高到低排序
        aiAccounts.sort((a, b) => (aiCommentCounts[b.id] || 0) - (aiCommentCounts[a.id] || 0));

        let html = '';
        html += `<div class="random-ai-toggle-row${window.App.randomAIMode ? ' active' : ''}" id="randomAIToggle">
            <span class="toggle-label"><span class="dice-icon">🎲</span> 随机AI模式</span>
            <div class="toggle-switch${window.App.randomAIMode ? ' active' : ''}" id="randomAIToggleSwitch"></div>
        </div>`;
        html += `<div style="padding:6px 14px 4px;font-size:11px;color:var(--text-light);font-weight:600;letter-spacing:.5px;">🤖 AI 虚拟评论员</div>`;
        html += aiAccounts.map(a => {
            const count = aiCommentCounts[a.id] || 0;
            const isActive = a.id === window.App.activeAIId;
            const act = a.activity ?? 1;
            const actBadge = `<span class="ai-activity-badge${act === 0 ? ' zero' : ''}">${act === 0 ? '已禁用' : '活跃' + act}</span>`;
            const aiAvText = a.avatarText || '🤖';
            const aiAvIsEmoji = window.App.isEmoji(aiAvText);
            return `<div class="account-dropdown-item${isActive ? ' active' : ''}" data-ai-id="${a.id}" style="${isActive ? 'background:#f0eeff;' : 'background:var(--btn-bg);'}">
            <div class="avatar-placeholder-sm" style="background:${a.avatarBg};font-size:${aiAvIsEmoji ? '18px' : '13px'};flex-shrink:0;">${window.App.escapeHtml(aiAvText)}</div>
            <span>${window.App.escapeHtml(a.nickname)}${window.App.randomAIMode ? actBadge : ''}</span>
            <span style="margin-left:auto;color:var(--text-light);font-size:11px;white-space:nowrap;">${count}条评论</span>
            ${isActive ? '<span class="check-mark" style="color:var(--ai-purple);">✓</span>' : ''}
            <span class="account-dropdown-edit" data-action="edit-ai" data-account-id="${a.id}">✎</span>
        </div>`;
        }).join('');
        html += `<div class="account-dropdown-add" id="btnAddAIAccount" style="color:var(--ai-purple);">+ 添加 AI 人设</div>`;
        $aiDropdown.innerHTML = html;

        const $toggleRow = $aiDropdown.querySelector('#randomAIToggle');
        const $toggleSwitch = $aiDropdown.querySelector('#randomAIToggleSwitch');
        const toggleRandomAI = () => {
            window.App.randomAIMode = !window.App.randomAIMode;
            localStorage.setItem(window.App.KEY_RANDOM_AI, window.App.randomAIMode);
            renderAIDropdown();
            renderHeader();
            window.App.showToastBottom(window.App.randomAIMode ? '🎲 随机AI模式已开启' : '🎲 随机AI模式已关闭');
        };
        if ($toggleRow) $toggleRow.addEventListener('click', (e) => { e.stopPropagation(); toggleRandomAI(); });
        if ($toggleSwitch) $toggleSwitch.addEventListener('click', (e) => { e.stopPropagation(); toggleRandomAI(); });

        $aiDropdown.querySelectorAll('[data-ai-id]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.dataset.action === 'edit-ai') { window.App.editAccount(e.target.dataset.accountId); return; }
                window.App.activeAIId = item.dataset.aiId;
                localStorage.setItem(window.App.KEY_ACTIVE_AI, window.App.activeAIId);
                $aiDropdown.style.display = 'none';
                window.App.showToastBottom('🤖 已切换：' + (window.App.getAcc(window.App.activeAIId)?.nickname || 'AI'));
                renderAIDropdown();
                renderHeader();
            });
        });
        document.getElementById('btnAddAIAccount')?.addEventListener('click', (e) => {
            e.stopPropagation();
            window.App.addAIAccount();
        });
    }

    function renderTimeline(reset = true) {
        const $timeline = $('#timeline');
        const $loader = $('#loaderIndicator');
        if (!$timeline) return;

        if (reset) {
            $timeline.innerHTML = '';
            renderedCount = 0;
            window.App.renderedCount = 0;
            allPostsRendered = false;
        }
        const sorted = [...window.App.posts].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp);
        const toRender = sorted.slice(renderedCount, renderedCount + PAGE_SIZE);
        if (toRender.length === 0) {
            if ($loader) $loader.style.display = 'none';
            if (renderedCount === 0 && $timeline.innerHTML === '') {
                $timeline.innerHTML = '<div class="timeline-empty"><span class="empty-icon">🌱</span><p>还没有动态</p></div>';
            }
            window.App.renderedCount = renderedCount;
            return;
        }
        const emptyEl = $timeline.querySelector('.timeline-empty');
        if (emptyEl) emptyEl.remove();
        toRender.forEach(p => {
            const div = document.createElement('div');
            div.innerHTML = renderCard(p);
            $timeline.appendChild(div.firstElementChild);
        });
        renderedCount += toRender.length;
        if ($loader) $loader.style.display = renderedCount >= sorted.length ? 'none' : 'block';
        bindCardEvents();
        observeMediaInContainer($timeline);
    }

    function renderCommentItem(c, postId) {
        const cu = window.App.getAcc(c.userId) || { nickname: '未知' };
        const isAI = cu?.isAI;
        return `<div class="comment-item">
                <div class="comment-content">
                    <span class="comment-user">${window.App.escapeHtml(cu.nickname)}${window.App.getBadgeHtml(cu)}：</span>
                    <span class="${isAI ? 'ai-comment-text' : ''}">${window.App.parseMarkdown(c.text)}</span>
                    <span class="comment-time">${window.App.formatTime(c.timestamp)}</span>
                </div>
                <button class="reply-btn" data-action="copy-comment" data-post-id="${postId}" data-comment-id="${c.id}">复制</button>
                <button class="delete-comment-btn" data-action="delete-comment" data-post-id="${postId}" data-comment-id="${c.id}" title="删除评论">✕</button>
            </div>`;
    }

    function renderCard(post) {
        let cmtsHtml = '';
        const author = window.App.getAcc(post.userId) || { nickname: '未知用户', avatar: '', avatarBg: '#ccc' };
        const isLiked = post.likes.includes(window.App.currentId);
        const likeCnt = post.likes.length;
        const cmtCnt = post.comments.length;
        let avatarHtml;
        if (author.avatarText) {
            avatarHtml = `<div class="post-avatar-placeholder" style="background:${author.avatarBg};font-size:${window.App.isEmoji(author.avatarText) ? '24px' : '16px'}">${window.App.escapeHtml(author.avatarText)}</div>`;
        } else if (author.avatar?.startsWith('data:')) {
            avatarHtml = `<img class="post-avatar" src="${author.avatar}">`;
        } else {
            avatarHtml = `<div class="post-avatar-placeholder" style="background:${author.avatarBg}">${author.nickname.charAt(0).toUpperCase()}</div>`;
        }

        let mediaHtml = '';
        const allImages = post.images || [];
        if (allImages.length) {
            mediaHtml += '<div class="post-images-grid' +
                (allImages.length === 1 ? ' single-col' : allImages.length === 2 ? ' double-col' : '') +
                '">';
            allImages.forEach((mid, i) => {
                mediaHtml += `<div class="post-image-wrapper" data-media-id="${mid}" data-post-id="${post.id}" data-image-index="${i}">
                <img data-media-id="${mid}" style="display:none;">
            </div>`;
            });
            mediaHtml += '</div>';
        }
        (post.videos || []).forEach(mid => mediaHtml +=
            `<div class="post-video-wrapper"><video controls data-media-id="${mid}"></video></div>`);

        if (post.comments.length) {
            const shouldCollapse = post.comments.length > COMMENT_COLLAPSE_THRESHOLD;
            const isExpanded = expandedPosts.has(post.id);
            const hiddenComments = shouldCollapse ? post.comments.slice(0, -COMMENT_COLLAPSE_THRESHOLD) : [];
            const visibleComments = shouldCollapse ? post.comments.slice(-COMMENT_COLLAPSE_THRESHOLD) : post.comments;
            cmtsHtml = '<div class="post-comments" data-post-id="' + post.id + '">';
            // 1. 折叠区域（旧评论，默认隐藏）
            if (shouldCollapse) {
                cmtsHtml += '<div class="comments-collapsed' + (isExpanded ? ' expanded' : '') + '" id="collapsed-' + post.id + '">';
                hiddenComments.forEach(c => { cmtsHtml += renderCommentItem(c, post.id); });
                cmtsHtml += '</div>';
            }
            // 2. 可见评论（最新的几条）
            visibleComments.forEach(c => { cmtsHtml += renderCommentItem(c, post.id); });
            // 3. 展开/收起按钮（放在最底部）
            if (shouldCollapse) {
                cmtsHtml += '<button class="comments-toggle-btn comments-expand-btn" data-action="toggle-comments" data-post-id="' + post.id + '" style="' + (isExpanded ? 'display:none;' : '') + '">展开 <span class="toggle-count">' + hiddenComments.length + '</span> 条评论 <span class="toggle-arrow">▾</span></button>';
                cmtsHtml += '<button class="comments-toggle-btn comments-collapse-btn" data-action="toggle-comments" data-post-id="' + post.id + '" style="' + (isExpanded ? '' : 'display:none;') + '">收起评论 <span class="toggle-arrow">▴</span></button>';
            }
            cmtsHtml += '</div>';
        }

        const curUser = window.App.getCurAcc();
        let curAvHtml;
        if (curUser?.avatarText) {
            curAvHtml = `<div class="comment-input-avatar-placeholder" data-post-id="${post.id}" title="双击发送AI评论" style="background:${curUser?.avatarBg || '#ccc'};font-size:${window.App.isEmoji(curUser.avatarText) ? '18px' : '12px'}">${window.App.escapeHtml(curUser.avatarText)}</div>`;
        } else if (curUser?.avatar?.startsWith('data:')) {
            curAvHtml = `<img class="comment-input-avatar" data-post-id="${post.id}" title="双击发送AI评论" src="${curUser.avatar}">`;
        } else {
            curAvHtml = `<div class="comment-input-avatar-placeholder" data-post-id="${post.id}" title="双击发送AI评论" style="background:${curUser?.avatarBg || '#ccc'}">${curUser?.nickname.charAt(0).toUpperCase() || '?'}</div>`;
        }

        let ghostTagHtml = '';
        if (post.ghostWriter) {
            const ghostAcc = window.App.getAcc(post.ghostWriter);
            ghostTagHtml = `<span style="font-size:11px;color:var(--text-light);margin-left:6px;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:1px 7px;cursor:pointer;" onclick="window.App.showGhostInfo('${post.id}')">✍️ ${window.App.escapeHtml(ghostAcc?.nickname || 'AI')}代笔</span>`;
        }

        return `<div class="post-card${post.pinned ? ' pinned-card' : ''}" id="post-${post.id}">${post.pinned ? '<div class="pin-badge">📌</div>' : ''}
        <div class="post-header">${avatarHtml}<div class="post-user-info"><div class="post-nickname">${window.App.escapeHtml(author.nickname)}</div><div class="post-time">${window.App.formatTime(post.timestamp)}</div>${ghostTagHtml}</div><button class="post-menu-btn" data-action="toggle-menu" data-post-id="${post.id}">⋯</button><div class="post-menu-dropdown" id="postMenu-${post.id}" style="display:none;"><button data-action="edit-post" data-post-id="${post.id}">✏️ 编辑</button><button data-action="toggle-pin" data-post-id="${post.id}">${post.pinned ? '取消置顶' : '📌 置顶'}</button><button data-action="share-post" data-post-id="${post.id}">📤 分享这条</button><button data-action="copy-post" data-post-id="${post.id}">📋 复制</button><button data-action="delete-post" data-post-id="${post.id}" class="danger">🗑️ 删除</button></div></div>
        ${post.text ? `<div class="post-text">${window.App.parseMarkdown(post.text)}</div>` : ''}
        ${mediaHtml}
        <div class="post-actions"><button class="action-btn${isLiked ? ' liked' : ''}" data-action="like" data-post-id="${post.id}">${isLiked ? '❤️' : '🤍'} ${likeCnt || '点赞'}</button><button class="action-btn" data-action="focus-comment" data-post-id="${post.id}">💬 ${cmtCnt || '评论'}</button></div>
        ${likeCnt ? `<div class="post-likes-bar">❤️ ${post.likes.map(uid => window.App.getAcc(uid)?.nickname || '未知').slice(0, 8).join('、')}${likeCnt > 8 ? ' 等' + likeCnt + '人' : ''}</div>` : ''}${cmtsHtml}
        <div class="comment-input-row">${curAvHtml}<textarea placeholder="写评论..." maxlength="500" id="commentInput-${post.id}" rows="1"></textarea>
<button class="ai-generate-btn" data-action="ai-comment" data-post-id="${post.id}">🤖生成</button>
<button class="comment-submit-btn" data-action="submit-comment" data-post-id="${post.id}">发送</button>`;
    }

    function observeMediaInContainer(container) {
        if (!container) return;
        container.querySelectorAll('.post-image-wrapper[data-media-id]').forEach(wrapper => {
            const img = wrapper.querySelector('img[data-media-id]');
            if (!img) return;
            if (img.getAttribute('src')) return;
            window.App.lazyMediaObserver.observe(wrapper);
        });
        container.querySelectorAll('video[data-media-id]').forEach(video => {
            if (video.getAttribute('src')) return;
            window.App.lazyMediaObserver.observe(video);
        });
    }

    function bindCardEvents() {
        const $timeline = $('#timeline');
        if (!$timeline) return;

        $timeline.querySelectorAll('.post-image-wrapper').forEach(w => w.onclick = () => {
            const post = window.App.posts.find(p => p.id === w.dataset.postId);
            if (post?.images?.length) window.App.openImageModal(post.images, parseInt(w.dataset.imageIndex));
        });
        $timeline.querySelectorAll('[data-action="toggle-menu"]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            window.App.toggleMenu(b.dataset.postId);
        });
        $timeline.querySelectorAll('[data-action="edit-post"]').forEach(b => b.onclick = () => window.App.openEditModal(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="toggle-pin"]').forEach(b => b.onclick = () => window.App.togglePin(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="delete-post"]').forEach(b => b.onclick = () => window.App.confirmDelete(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="share-post"]').forEach(b => b.onclick = () => window.App.sharePost(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="copy-post"]').forEach(b => b.onclick = () => window.App.copyPost(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="like"]').forEach(b => b.onclick = () => window.App.toggleLike(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="focus-comment"]').forEach(b => b.onclick = () => {
            const inp = document.getElementById('commentInput-' + b.dataset.postId);
            if (inp) {
                inp.scrollIntoView({ block: 'center' });
                inp.focus({ preventScroll: true });
            }
        });
        $timeline.querySelectorAll('[data-action="submit-comment"]').forEach(b => b.onclick = () => window.App.submitComment(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="ai-comment"]').forEach(b => b.onclick = () => window.App.generateAIComment(b.dataset.postId));
        $timeline.querySelectorAll('[data-action="copy-comment"]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            window.App.copyComment(b.dataset.postId, b.dataset.commentId);
        });
        $timeline.querySelectorAll('[data-action="delete-comment"]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                window.App.deleteComment(btn.dataset.postId, btn.dataset.commentId);
            };
        });
        $timeline.querySelectorAll('[data-action="toggle-comments"]').forEach(b => b.onclick = () => window.App.toggleCommentCollapse(b.dataset.postId));
        // 双击评论头像 → AI 发送
        $timeline.querySelectorAll('.comment-input-avatar-placeholder, .comment-input-avatar').forEach(avatar => {
            avatar.ondblclick = () => {
                const postId = avatar.dataset.postId;
                if (postId && window.App.submitAIComment) {
                    window.App.submitAIComment(postId);
                }
            };
        });
    }

    function updateCard(id) {
        const post = window.App.posts.find(p => p.id === id);
        if (!post) return;
        const old = document.getElementById('post-' + id);
        if (!old) return;
        const div = document.createElement('div');
        div.innerHTML = renderCard(post);
        const newCard = div.firstElementChild;
        old.replaceWith(newCard);
        bindCardEvents();
        observeMediaInContainer(newCard);
    }

    function toggleMenu(id) {
        const menu = document.getElementById('postMenu-' + id);
        if (!menu) return;
        const vis = menu.style.display === 'block';
        document.querySelectorAll('.post-menu-dropdown').forEach(m => m.style.display = 'none');
        menu.style.display = vis ? 'none' : 'block';
    }

    function togglePin(id) {
        const post = window.App.posts.find(p => p.id === id);
        if (!post) return;
        post.pinned = !post.pinned;
        window.App.savePosts();
        renderTimeline(true);
    }

    function toggleLike(id) {
        const post = window.App.posts.find(p => p.id === id);
        if (!post) return;
        const idx = post.likes.indexOf(window.App.currentId);
        idx >= 0 ? post.likes.splice(idx, 1) : post.likes.push(window.App.currentId);
        window.App.savePosts();
        const card = document.getElementById('post-' + id);
        if (!card) return;
        const likeBtn = card.querySelector('[data-action="like"]');
        const likesBar = card.querySelector('.post-likes-bar');
        const isLiked = post.likes.includes(window.App.currentId);
        const likeCnt = post.likes.length;

        if (likeBtn) {
            likeBtn.className = 'action-btn' + (isLiked ? ' liked' : '');
            likeBtn.innerHTML = (isLiked ? '❤️' : '🤍') + ' ' + (likeCnt || '点赞');
        }

        if (likeCnt) {
            const names = post.likes.map(uid => window.App.getAcc(uid)?.nickname || '未知').slice(0, 8).join('、');
            const extra = likeCnt > 8 ? ' 等' + likeCnt + '人' : '';
            const newHtml = '❤️ ' + names + extra;
            if (likesBar) {
                likesBar.innerHTML = newHtml;
                likesBar.style.display = '';
            } else {
                const bar = document.createElement('div');
                bar.className = 'post-likes-bar';
                bar.textContent = newHtml;
                const actions = card.querySelector('.post-actions');
                if (actions) {
                    actions.after(bar);
                }
            }
        } else {
            if (likesBar) {
                likesBar.remove();
            }
        }
    }

    function submitComment(id) {
        const inp = document.getElementById('commentInput-' + id);
        if (!inp) return;
        const text = inp.value.trim();
        if (!text) return;
        const post = window.App.posts.find(p => p.id === id);
        if (!post) return;
        post.comments.push({ id: 'cmt_' + Date.now(), userId: window.App.currentId, text, timestamp: Date.now() });
        window.App.savePosts();
        updateCard(id);
        const newInp = document.getElementById('commentInput-' + id);
        if (newInp) newInp.focus({ preventScroll: true });
    }

    function deleteComment(postId, commentId) {
        const post = window.App.posts.find(p => p.id === postId);
        if (!post) return;
        post.comments = post.comments.filter(c => c.id !== commentId);
        window.App.savePosts();
        updateCard(postId);
    }

    function toggleCommentCollapse(postId) {
        const collapsed = document.getElementById('collapsed-' + postId);
        if (!collapsed) return;
        const isExpanded = collapsed.classList.contains('expanded');
        collapsed.classList.toggle('expanded');
        if (isExpanded) {
            expandedPosts.delete(postId);
        } else {
            expandedPosts.add(postId);
        }
        const expandBtn = document.querySelector('.comments-expand-btn[data-post-id="' + postId + '"]');
        const collapseBtn = document.querySelector('.comments-collapse-btn[data-post-id="' + postId + '"]');
        if (expandBtn) expandBtn.style.display = isExpanded ? 'block' : 'none';
        if (collapseBtn) collapseBtn.style.display = isExpanded ? 'none' : 'block';
    }

    function switchAccount(id) {
        if (id === window.App.currentId) {
            const $normalDropdown = $('#normalDropdown');
            if ($normalDropdown) $normalDropdown.style.display = 'none';
            return;
        }
        const $publishText = $('#publishText');
        const savedText = $publishText?.value || '';
        const savedFiles = window.App.publishFiles.slice();
        const savedEditingId = window.App.editingPostId;
        const scheduleTime = $('#scheduleTime');
        const savedSchedule = scheduleTime?.value || '';
        const savedScheduleDisplay = scheduleTime?.style.display || 'none';
        const $btnPublish = $('#btnPublish');
        const savedBtnText = $btnPublish?.textContent || '发布';

        window.App.currentId = id;
        localStorage.setItem(window.App.KEY_CUR, id);
        const $normalDropdown = $('#normalDropdown');
        if ($normalDropdown) $normalDropdown.style.display = 'none';
        renderHeader();
        renderNormalDropdown();
        renderAIDropdown();
        renderTimeline(true);
        window.App.updatePublishBtn();

        if ($publishText) $publishText.value = savedText;
        window.App.publishFiles = savedFiles;
        window.App.editingPostId = savedEditingId;
        if (scheduleTime) {
            scheduleTime.value = savedSchedule;
            scheduleTime.style.display = savedScheduleDisplay;
        }
        if ($btnPublish) $btnPublish.textContent = savedBtnText;
        window.App.renderPublishPreview();
        window.App.updatePublishBtn();
    }

    function filterPosts(keyword) {
        if (!keyword.trim()) return window.App.posts;
        const kw = window.App.removeSpaces(keyword.toLowerCase());
        return window.App.posts.filter(p => {
            const rawText = window.App.removeSpaces((p.text || '').toLowerCase());
            const rawNick = window.App.removeSpaces((window.App.getAcc(p.userId)?.nickname || '').toLowerCase());
            const marklessText = window.App.removeSpaces(window.App.stripMarkdown(p.text || '').toLowerCase());
            const marklessNick = window.App.removeSpaces(window.App.stripMarkdown(window.App.getAcc(p.userId)?.nickname || '').toLowerCase());
            return rawText.includes(kw) || rawNick.includes(kw) ||
                marklessText.includes(kw) || marklessNick.includes(kw);
        });
    }

    function renderSearchResults(keyword) {
        const $timeline = $('#timeline');
        const $loader = $('#loaderIndicator');
        if (!$timeline) return;

        const filtered = filterPosts(keyword).sort((a, b) => b.timestamp - a.timestamp);
        $timeline.innerHTML = '';
        if (!filtered.length) {
            $timeline.innerHTML =
                '<div class="timeline-empty"><span class="empty-icon">🔍</span><p>未找到相关动态</p></div>';
            return;
        }
        filtered.forEach(p => {
            const div = document.createElement('div');
            div.innerHTML = renderCard(p);
            $timeline.appendChild(div.firstElementChild);
        });
        bindCardEvents();
        observeMediaInContainer($timeline);
        if ($loader) $loader.style.display = 'none';
    }

    window.App = window.App || {};
    window.App.renderHeader = renderHeader;
    window.App.closeAllDropdowns = closeAllDropdowns;
    window.App.renderNormalDropdown = renderNormalDropdown;
    window.App.renderAIDropdown = renderAIDropdown;
    // 渲染语录卡片
    function renderQuoteCard(quote) {
        var quoteText = document.getElementById('quoteText');
        var quoteAuthor = document.getElementById('quoteAuthor');
        var quoteBody = document.getElementById('quoteBody');
        var quoteLoading = document.getElementById('quoteLoading');
        if (!quoteText || !quoteAuthor) return;

        if (quoteLoading) quoteLoading.classList.remove('visible');
        if (quoteBody) quoteBody.classList.add('visible');
        quoteText.textContent = quote.text;
        quoteAuthor.textContent = '—— ' + quote.aiName;
    }

    function showQuoteLoading() {
        var quoteBody = document.getElementById('quoteBody');
        var quoteLoading = document.getElementById('quoteLoading');
        if (quoteBody) quoteBody.classList.remove('visible');
        if (quoteLoading) quoteLoading.classList.add('visible');
    }

    // 收藏语录弹窗
    function showSavedQuotesModal() {
        var savedQuotes = window.App.getSavedQuotes ? window.App.getSavedQuotes() : [];
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = '<div class="modal-dialog" style="max-width:420px;padding:18px 20px;">' +
            '<h3>🔖 收藏语录</h3>' +
            '<div class="saved-quotes-list" style="max-height:60vh;overflow-y:auto;margin-top:12px;">' +
            (savedQuotes.length === 0
                ? '<div class="saved-quotes-empty">还没有收藏语录</div>'
                : savedQuotes.map(function (q, i) {
                    var savedDate = q.savedAt ? new Date(q.savedAt).toISOString().slice(0, 10).replace(/-/g, '.') : '';
                    return '<div class="saved-quote-item">' +
                        '<span class="saved-quote-text">' + window.App.escapeHtml(q.text) + '</span>' +
                        '<div class="saved-quote-footer">' +
                        '<span class="saved-quote-date">' + savedDate + '</span>' +
                        '<span class="saved-quote-author">—— ' + window.App.escapeHtml(q.aiName) + '</span>' +
                        '</div>' +
                        '<button class="saved-quote-delete" data-idx="' + i + '">✕</button>' +
                        '</div>';
                }).join('')
            ) +
            '</div>' +
            '<div class="btn-row" style="margin-top:14px;justify-content:flex-end;">' +
            '<button class="btn btn-cancel" id="savedQuotesClose">关闭</button>' +
            '</div></div>';
        document.body.appendChild(overlay);

        overlay.querySelector('#savedQuotesClose').onclick = function () { overlay.remove(); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        overlay.querySelectorAll('.saved-quote-delete').forEach(function (btn) {
            btn.onclick = function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.dataset.idx);
                if (window.App.removeSavedQuote) {
                    window.App.removeSavedQuote(idx);
                }
                overlay.remove();
                showSavedQuotesModal();
            };
        });
    }

    window.App.renderSidebarAIList = renderSidebarAIList;
    window.App.renderQuoteCard = renderQuoteCard;
    window.App.showQuoteLoading = showQuoteLoading;
    window.App.showSavedQuotesModal = showSavedQuotesModal;
    window.App.renderTimeline = renderTimeline;
    window.App.renderCard = renderCard;
    window.App.observeMediaInContainer = observeMediaInContainer;
    window.App.bindCardEvents = bindCardEvents;
    window.App.updateCard = updateCard;
    window.App.toggleMenu = toggleMenu;
    window.App.togglePin = togglePin;
    window.App.toggleLike = toggleLike;
    window.App.submitComment = submitComment;
    window.App.deleteComment = deleteComment;
    window.App.toggleCommentCollapse = toggleCommentCollapse;
    window.App.COMMENT_COLLAPSE_THRESHOLD = COMMENT_COLLAPSE_THRESHOLD;
    window.App.switchAccount = switchAccount;
    window.App.filterPosts = filterPosts;
    window.App.renderSearchResults = renderSearchResults;
    window.App.searchActive = searchActive;
    window.App.PAGE_SIZE = PAGE_SIZE;
    window.App.renderedCount = renderedCount;
    window.App.allPostsRendered = allPostsRendered;
})();
