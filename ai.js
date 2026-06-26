(function () {
    const $ = (s) => document.querySelector(s);

    // ── 从 AI 回复中提取 shouldLike 决策（宽松正则，不依赖完整 JSON）──
    function extractShouldLike(text) {
        const m = text.match(/"shouldLike"\s*:\s*(true|false)/i);
        return m ? m[1] === 'true' : false;
    }
    // 从回复末尾剥离 JSON 元数据
    function stripJsonMetadata(text) {
        return text.replace(/\s*\{[^}]*"shouldLike"[^}]*\}\s*$/g, '').trim();
    }
    // ── 让 AI 账号点赞帖子 ──
    function applyAILike(postId, aiId) {
        const post = window.App.posts.find(p => p.id === postId);
        if (!post) return;
        if (post.likes.includes(aiId)) return; // 已点过
        post.likes.push(aiId);
        window.App.savePosts();
        // 在后台刷新卡片以更新点赞栏
        if (window.App.updateCard) {
            window.App.updateCard(postId);
        }
    }

    function ensureAIAccount() {
        // 确保 activeAIId 指向一个仍然存在的 AI 账号，但不自动创建新账号
        if (window.App.activeAIId && !window.App.accounts.find(a => a.id === window.App.activeAIId && a.isAI)) {
            window.App.activeAIId = window.App.accounts.find(a => a.isAI)?.id || null;
            if (window.App.activeAIId) localStorage.setItem(window.App.KEY_ACTIVE_AI, window.App.activeAIId);
            else localStorage.removeItem(window.App.KEY_ACTIVE_AI);
        }
    }

    function submitAIComment(id) {
        const commentAIId = window.App.activeAIId || window.App.accounts.find(a => a.isAI)?.id;
        if (!commentAIId) {
            window.App.showToast('⚠️ 没有可用的AI账号，请添加AI人设');
            return;
        }
        const inp = document.getElementById('commentInput-' + id);
        if (!inp) return;
        const text = inp.value.trim();
        if (!text) return;
        const post = window.App.posts.find(p => p.id === id);
        if (!post) return;
        post.comments.push({ id: 'cmt_ai_' + Date.now(), userId: commentAIId, text, timestamp: Date.now() });
        window.App.savePosts();
        inp.value = '';
        delete inp.dataset.fromAI;
        window.App.updateCommentsSection(id);
        window.App.showToast('🤖 AI 已评论');
    }

    function publishAIComment(postId, aiUserId, text) {
        const post = window.App.posts.find(p => p.id === postId);
        if (!post) return;
        post.comments.push({ id: 'cmt_ai_' + Date.now(), userId: aiUserId, text, timestamp: Date.now() });
        window.App.savePosts();
        window.App.updateCommentsSection(postId);
        window.App.showToast('🤖 AI 已评论');
    }

    function showAICommentModal(postId, aiAcc, reply) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        const avatarHtml = aiAcc.avatar
            ? `<img class="post-avatar" src="${window.App.escapeHtml(aiAcc.avatar)}" alt="" style="width:36px;height:36px;">`
            : `<div class="post-avatar-placeholder" style="width:36px;height:36px;font-size:14px;background:${aiAcc.avatarBg || '#6c5ce7'};">${window.App.escapeHtml(aiAcc.avatarText || aiAcc.nickname?.charAt(0) || 'A')}</div>`;

        overlay.innerHTML = `
            <div class="modal-dialog ai-comment-modal">
                <div class="ai-comment-modal-header">
                    ${avatarHtml}
                    <span class="ai-comment-modal-name">${window.App.escapeHtml(aiAcc.nickname)}</span>
                    <span class="ai-comment-modal-badge">AI</span>
                </div>
                <textarea class="ai-comment-modal-textarea" id="aiCommentModalText-${postId}" maxlength="5000">${window.App.escapeHtml(reply)}</textarea>
                <div class="ai-comment-modal-actions">
                    <button class="btn btn-cancel" id="aiCommentModalRegen-${postId}">🔄 重新生成</button>
                    <div class="ai-comment-modal-right">
                        <button class="btn btn-cancel" id="aiCommentModalCancel-${postId}">取消</button>
                        <button class="btn btn-save ai-comment-modal-send" id="aiCommentModalSend-${postId}">发送</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const textarea = overlay.querySelector('#aiCommentModalText-' + postId);
        // 自动调整高度，适配内容
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
        textarea.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });

        const regenBtn = overlay.querySelector('#aiCommentModalRegen-' + postId);
        const cancelBtn = overlay.querySelector('#aiCommentModalCancel-' + postId);
        const sendBtn = overlay.querySelector('#aiCommentModalSend-' + postId);

        // 不自动聚焦 textarea，避免移动端弹键盘

        const close = () => overlay.remove();

        cancelBtn.onclick = close;
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        sendBtn.onclick = () => {
            const text = textarea.value.trim();
            if (!text) return;
            close();
            publishAIComment(postId, aiAcc.id, text);
        };

        regenBtn.onclick = async () => {
            regenBtn.disabled = true;
            regenBtn.textContent = '⏳ 生成中...';
            let timeoutId;
            try {
                const post = window.App.posts.find(p => p.id === postId);
                if (!post) { close(); return; }

                const base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
                const isVolcengine = /volces\.com/i.test(window.App.aiConfig.endpoint);
                const url = base + (isVolcengine ? '/responses' : '/chat/completions');
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), (window.App.aiConfig.timeout || 15) * 1000);

                const aiName = aiAcc.nickname || 'AI助手';
                const basePrompt = aiAcc.systemPrompt || '你是一个友善的朋友';
                let systemPrompt = `你是"${aiName}"，${basePrompt}。你需要严格遵守你的独立人设。请为朋友圈生成一条简短的评论。直接给出评论内容，不要在评论前加上名字。**请使用 Markdown 格式排版**，以获得更好的呈现效果。`;
                const activeStyle = aiAcc.style || '';
                if (activeStyle) systemPrompt += ` 你的评论风格要：${activeStyle}。`;
                systemPrompt += ` 另外请在评论末尾附一个JSON表示你是否要点赞这条帖子：{"shouldLike":true} 或 {"shouldLike":false}。`;

                const author = window.App.getAcc(post.userId)?.nickname || '用户';
                const timeDesc = window.App.formatTime(post.timestamp);
                let contentDesc = post.userId === aiAcc.id
                    ? `你（${author}）于 ${timeDesc} 自己发布了这条动态`
                    : `${author} 于 ${timeDesc} 发布了动态`;
                if (post.text) contentDesc += `：${post.text}`;
                const likedNames = (post.likes || []).map(uid => window.App.getAcc(uid)?.nickname || '未知').join('、');
                if ((post.userId === aiAcc.id) && likedNames) contentDesc += `\n\n当前已有点赞：${likedNames}。`;

                const messages = isVolcengine
                    ? [{ role: 'user', content: [{ type: 'input_text', text: systemPrompt + '\n\n' + contentDesc }] }]
                    : [{ role: 'system', content: systemPrompt }, { role: 'user', content: contentDesc }];

                let body;
                if (isVolcengine) {
                    body = { model: window.App.aiConfig.model, input: messages, thinking: { type: window.App.aiConfig.thinking ? 'enabled' : 'disabled' } };
                } else {
                    body = { model: window.App.aiConfig.model, messages, max_tokens: 2000, temperature: 0.8 };
                    if (!window.App.aiConfig.thinking && window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
                }

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!res.ok) {
                    let errMsg = `API ${res.status}`;
                    try { const errData = await res.json(); errMsg = errData?.error?.message || errMsg; } catch (_) {}
                    throw new Error(errMsg);
                }
                const data = await res.json();
                const rawReply = (isVolcengine
                    ? data.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text
                    : data.choices?.[0]?.message?.content)?.trim();
                if (!rawReply) throw new Error('未生成有效回复');

                const shouldLike = extractShouldLike(rawReply);
                const newReply = stripJsonMetadata(rawReply);
                if (shouldLike) applyAILike(postId, aiAcc.id);

                textarea.value = newReply;
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            } catch (e) {
                clearTimeout(timeoutId);
                if (e.name === 'AbortError') window.App.showToast('⏰ AI 请求超时');
                else window.App.showToast('❌ ' + e.message);
            } finally {
                regenBtn.disabled = false;
                regenBtn.textContent = '🔄 重新生成';
            }
        };

        textarea.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.isComposing) {
                const isMobile = window.matchMedia('not (pointer: fine)').matches;
                if (!isMobile) {
                    e.preventDefault();
                    sendBtn.click();
                }
            }
        });
    }

    async function generateAIComment(postId) {
        const post = window.App.posts.find(p => p.id === postId);
        if (!post) return;
        const aiAccounts = window.App.accounts.filter(a => a.isAI);
        if (!aiAccounts.length) {
            window.App.showToast('⚠️ 请先在"账号切换"中添加AI人设');
            return;
        }
        if (!window.App.aiConfig.endpoint || !window.App.aiConfig.model) {
            window.App.showToast('⚠️ 请先配置AI');
            return;
        }

        const btn = document.querySelector(`#timeline [data-post-id="${postId}"][data-action="ai-comment"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳';
        }

        // ===== 随机AI模式：按活跃度权重抽取 =====
        let selectedAIId = window.App.activeAIId;
        let selectedAIAcc = window.App.getAcc(window.App.activeAIId);
        if (window.App.randomAIMode) {
            const candidates = aiAccounts.filter(a => (a.activity ?? 1) > 0);
            if (candidates.length === 0) {
                window.App.showToast('⚠️ 所有AI活跃度都为0，无法随机抽取');
                if (btn) { btn.disabled = false; btn.textContent = '🤖'; }
                return;
            }
            const totalWeight = candidates.reduce((sum, a) => sum + (a.activity ?? 1), 0);
            let rand = Math.random() * totalWeight;
            let picked = candidates[0];
            for (const c of candidates) {
                rand -= (c.activity ?? 1);
                if (rand <= 0) { picked = c; break; }
            }
            selectedAIId = picked.id;
            selectedAIAcc = picked;
            window.App.activeAIId = selectedAIId;
            localStorage.setItem(window.App.KEY_ACTIVE_AI, window.App.activeAIId);
        }

        if (!selectedAIAcc) {
            selectedAIAcc = aiAccounts[0];
            selectedAIId = selectedAIAcc.id;
        }

        // ===== 显示"正在思考"提示条 =====
        const $thinkingBar = $('#aiThinkingBar');
        const $thinkingAvatar = $('#thinkingAvatar');
        const $thinkingText = $('#thinkingText');
        if ($thinkingBar) {
            $thinkingAvatar.style.background = selectedAIAcc.avatarBg || '#6c5ce7';
            $thinkingAvatar.textContent = '🤖';
            $thinkingText.innerHTML = `AI 正在以 <b>${window.App.escapeHtml(selectedAIAcc.nickname)}</b> 的身份思考<span class="thinking-dots"></span>`;
            $thinkingBar.classList.add('visible');
        }

        const author = window.App.getAcc(post.userId)?.nickname || '用户';
        const timeDesc = window.App.formatTime(post.timestamp);

        // ===== 检测模型是否支持视觉（多模态） =====
        const modelSupportsVision = window.App.aiConfig.vision === true;

        // ===== 收集图片URL（仅当模型支持视觉时） =====
        let imageUrls = [];
        if (modelSupportsVision && (post.images?.length || /!\[[^\]]*\]\(/.test(post.text))) {
            const collected = [];

            // 1. 直接上传的图片（从images数组获取Cloudflare Storage URL）
            if (post.images && post.images.length && window._fbGetMediaUrl) {
                for (const mid of post.images.slice(0, 4)) { // 最多4张
                    try {
                        const url = await window._fbGetMediaUrl(mid);
                        if (url) collected.push(url);
                    } catch (e) {
                        // 无法获取就跳过
                    }
                }
            }

            // 2. Markdown 图片链接（提取远程URL）
            const mdImgRegex = /!\[[^\]]*\]\(([^\s)]+)\)/g;
            let match;
            while ((match = mdImgRegex.exec(post.text || '')) !== null) {
                const url = match[1];
                if (url && /^https?:\/\//i.test(url)) {
                    collected.push(url);
                }
            }

            // 去重并限制数量
            imageUrls = [...new Set(collected)].slice(0, 4);
        }

        // ===== 1. 构建强身份系统提示词 =====
        const aiName = selectedAIAcc?.nickname || 'AI助手';
        const basePrompt = selectedAIAcc?.systemPrompt || '你是一个友善的朋友';
        const fixedSuffix = '请为朋友圈生成一条简短的评论。';
        let systemPrompt = `你是"${aiName}"，${basePrompt}。你需要严格遵守你的独立人设，不要将其他用户的评论当成你的发言。${fixedSuffix}`;
        systemPrompt += `直接给出评论内容，不要在评论前加上"${aiName}："或类似称呼。`;
        systemPrompt += `\n\n**请使用 Markdown 格式排版**，以获得更好的呈现效果。`;
        const activeStyle = selectedAIAcc?.style || '';
        if (activeStyle) systemPrompt += ` 你的评论风格要：${activeStyle}。`;
        systemPrompt += ` 另外请在评论末尾附一个JSON表示你是否要点赞这条帖子：{"shouldLike":true} 或 {"shouldLike":false}。`;

        const isVolcengine = /volces\.com/i.test(window.App.aiConfig.endpoint);
        const messages = [{ role: 'system', content: systemPrompt }];

        // ===== 2. 构建用户消息（描述当前帖子） =====
        const isSelfPost = post.userId === selectedAIId;
        let contentDesc = isSelfPost
            ? `你（${author}）于 ${timeDesc} 自己发布了这条动态`
            : `${author} 于 ${timeDesc} 发布了动态`;
        if (post.text) contentDesc += `：${post.text}`;
        const imgCnt = post.images?.length || 0;
        const vidCnt = post.videos?.length || 0;
        if (imgCnt || vidCnt) {
            const parts = [];
            if (imgCnt) parts.push(`${imgCnt}张图片`);
            if (vidCnt) parts.push(`${vidCnt}个视频`);
            contentDesc += ` 分享了${parts.join('和')}。`;
        }
        contentDesc += isSelfPost
            ? ' 这是你自己的帖子，请以作者身份补充一句回应评论区的话，或者分享一点后续感受。'
            : ' 请以你的身份写一条简短的评论。';
        const likedNames = (post.likes || []).filter(uid => uid !== selectedAIId).map(uid => window.App.getAcc(uid)?.nickname || '未知').join('、');
        if (isSelfPost && likedNames) contentDesc += `\n\n当前已有点赞：${likedNames}。`;

        // ===== 构造 user 消息（多模态 vs 纯文本） =====
        // 火山引擎：图片延后到最终 user 轮附加，避免出现在非末尾位置导致 400
        if (imageUrls.length > 0 && !isVolcengine) {
            // 非火山：图片直接放第一条 user 消息
            const contentArray = [{ type: 'text', text: contentDesc }];
            imageUrls.forEach(url => contentArray.push({ type: 'image_url', image_url: { url } }));
            messages.push({ role: 'user', content: contentArray });
        } else {
            // 火山 or 纯文本：先不带图片，图片由后面逻辑决定放在哪条 user 消息
            const text = isVolcengine ? systemPrompt + '\n\n' + contentDesc : contentDesc;
            messages.push({
                role: 'user',
                content: isVolcengine ? [{ type: 'input_text', text }] : text
            });
        }

        // ===== 3. 将历史评论作为上下文描述注入最后一条 user 消息（始终单轮，无多轮风险）=====
        if (post.comments.length) {
            const recent = post.comments.slice(-15);
            const myComments = recent.filter(c => c.userId === selectedAIId);
            const otherComments = recent.filter(c => c.userId !== selectedAIId);
            const extraLines = [];
            if (otherComments.length) {
                const othersText = otherComments
                    .map(c => `${window.App.getAcc(c.userId)?.nickname || '用户'}：${c.text}`)
                    .join('\n');
                extraLines.push(`已有的其他用户评论：\n${othersText}`);
            }
            if (myComments.length) {
                const myText = myComments.map(c => c.text).join('、');
                extraLines.push(`你已经评论过："${myText}"，请生成一条新评论。`);
            }
            if (extraLines.length) {
                const extra = '\n\n' + extraLines.join('\n');
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role === 'user') {
                    if (Array.isArray(lastMsg.content)) {
                        lastMsg.content.push({ type: isVolcengine ? 'input_text' : 'text', text: extra });
                    } else {
                        lastMsg.content += extra;
                    }
                }
            }
        }

        // ===== ★ 火山引擎：图片附加到最后一条 user 消息 =====
        if (isVolcengine && imageUrls.length > 0) {
            const lastUserMsg = messages.slice().reverse().find(m => m.role === 'user');
            if (lastUserMsg && Array.isArray(lastUserMsg.content)) {
                imageUrls.forEach(url => lastUserMsg.content.push({ type: 'input_image', image_url: url }));
            }
        }

        // ===== 4. 调用 API =====
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), (window.App.aiConfig.timeout || 15) * 1000);
        try {
            const base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
            let body, url;
            if (isVolcengine) {
                // 火山引擎 responses API：system prompt 已塞入第一条 user 消息，跳过 system 消息
                url = base + '/responses';
                const input = messages.filter(m => m.role !== 'system').map(m => { const item = { role: m.role, content: m.content }; if (m.status) item.status = m.status; return item; });
                body = { model: window.App.aiConfig.model, input, thinking: { type: window.App.aiConfig.thinking ? 'enabled' : 'disabled' } };
            } else {
                // OpenAI-compatible chat/completions
                url = base + '/chat/completions';
                body = { model: window.App.aiConfig.model, messages, max_tokens: 2000, temperature: 0.8 };
                if (!window.App.aiConfig.thinking && window.App.aiConfig.model?.includes('deepseek-v4') && imageUrls.length === 0) body.thinking = { type: 'disabled' };
            }
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                let errMsg = `API ${res.status}`;
                try { const errData = await res.json(); errMsg = errData?.error?.message || errMsg; } catch (_) {}
                throw new Error(errMsg);
            }
            const data = await res.json();
            // 火山引擎 responses API 返回 output（含 reasoning + message），OpenAI 返回 choices
            const rawReply = (isVolcengine
                ? data.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text
                : data.choices?.[0]?.message?.content)?.trim();
            if (!rawReply) throw new Error('未生成有效回复');

            const shouldLike = extractShouldLike(rawReply);
            const reply = stripJsonMetadata(rawReply);
            if (shouldLike) applyAILike(postId, selectedAIAcc.id);

            showAICommentModal(postId, selectedAIAcc, reply);
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') window.App.showToast('⏰ AI 请求超时');
            else window.App.showToast('❌ ' + e.message);
        } finally {
            if ($thinkingBar) $thinkingBar.classList.remove('visible');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🤖';
            }
            if (window.App.randomAIMode) {
                window.App.renderHeader();
                window.App.renderAIDropdown();
            }
        }
    }

    function openAISettings() {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        function saveFormToPreset(pid) {
            var sel = overlay.querySelector('#presetSelector');
            if (!pid) pid = sel ? sel.value : null;
            if (!pid) return;
            var p = window.App.aiPresets.find(function (p) { return p.id === pid; });
            if (!p) return;
            p.name = overlay.querySelector('#presetName').value.trim() || '未命名';
            p.endpoint = overlay.querySelector('#aiEndpoint').value.trim();
            p.apiKey = overlay.querySelector('#aiApiKey').value.trim();
            p.model = overlay.querySelector('#aiModel').value.trim();
            p.timeout = parseInt(overlay.querySelector('#aiTimeout').value) || 30;
            p.vision = overlay.querySelector('#toggleRowVision .toggle-switch').classList.contains('active');
            p.thinking = overlay.querySelector('#toggleRowThinking .toggle-switch').classList.contains('active');
        }

        function loadPresetToForm(pid) {
            var p = window.App.aiPresets.find(function (p) { return p.id === pid; });
            if (!p) return;
            overlay.querySelector('#presetName').value = p.name || '';
            overlay.querySelector('#aiEndpoint').value = p.endpoint || '';
            overlay.querySelector('#aiApiKey').value = p.apiKey || '';
            overlay.querySelector('#aiModel').value = p.model || '';
            overlay.querySelector('#aiTimeout').value = p.timeout || 30;
            var visionToggle = overlay.querySelector('#toggleRowVision .toggle-switch');
            visionToggle.classList.toggle('active', p.vision !== false);
            var thinkingToggle = overlay.querySelector('#toggleRowThinking .toggle-switch');
            thinkingToggle.classList.toggle('active', p.thinking === true);
        }

        function refreshSelector() {
            var sel = overlay.querySelector('#presetSelector');
            if (!sel) return;
            sel.innerHTML = window.App.aiPresets.map(function (p) {
                return '<option value="' + p.id + '">' + window.App.escapeHtml(p.name || '未命名') + '</option>';
            }).join('');
            sel.value = window.App.activePresetId;
            var delBtn = overlay.querySelector('#deletePresetBtn');
            if (delBtn) delBtn.style.display = window.App.aiPresets.length > 1 ? '' : 'none';
        }

        overlay.innerHTML = '<div class="modal-dialog" style="max-width:min(90vw, 480px);">' +
            '<h3>🤖 AI API 配置</h3>' +
            '<label>方案</label>' +
            '<div style="display:flex;gap:6px;margin-top:4px;">' +
            '<select id="presetSelector" style="flex:1; border-radius:8px;">' +
            window.App.aiPresets.map(function (p) { return '<option value="' + p.id + '">' + window.App.escapeHtml(p.name || '未命名') + '</option>'; }).join('') +
            '</select>' +
            '<button class="btn btn-danger" id="deletePresetBtn" title="删除当前方案" style="flex-shrink:0;' + (window.App.aiPresets.length <= 1 ? 'display:none;' : '') + '">🗑️</button>' +
            '</div>' +
            '<button class="btn btn-cancel" id="newPresetBtn" style="width:100%;margin-top:6px;text-align:center;">+ 新建方案</button>' +
            '<label style="margin-top:10px;">方案名称</label>' +
            '<input type="text" id="presetName" value="' + window.App.escapeHtml(window.App.aiConfig.name || '') + '" maxlength="20" placeholder="例如：DeepSeek、OpenAI" style="margin-top:4px;">' +
            '<label>baseURL</label>' +
            '<input type="text" id="aiEndpoint" value="' + window.App.escapeHtml(window.App.aiConfig.endpoint || '') + '" placeholder="https://api.deepseek.com" style="margin-top:4px;">' +
            '<label>API 密钥</label>' +
            '<input type="password" id="aiApiKey" value="' + window.App.escapeHtml(window.App.aiConfig.apiKey || '') + '" placeholder="sk-..." style="margin-top:4px;">' +
            '<label>模型名称</label>' +
            '<input type="text" id="aiModel" value="' + window.App.escapeHtml(window.App.aiConfig.model || '') + '" placeholder="deepseek-v4-pro" style="margin-top:4px;">' +
            '<label>请求超时（秒）</label>' +
            '<input type="number" id="aiTimeout" value="' + (window.App.aiConfig.timeout || 30) + '" min="1" max="120" style="margin-top:4px;">' +
            '<div class="settings-toggle-row" id="toggleRowVision">' +
            '<span>支持图片（视觉/多模态）</span>' +
            '<div class="toggle-switch' + (window.App.aiConfig.vision !== false ? ' active' : '') + '"></div>' +
            '</div>' +
            '<div class="settings-toggle-row" id="toggleRowThinking">' +
            '<span>开启思考模式（深度推理）</span>' +
            '<div class="toggle-switch' + (window.App.aiConfig.thinking ? ' active' : '') + '"></div>' +
            '</div>' +
            '<div class="btn-row" style="margin-bottom:8px;">' +
            '<button class="btn btn-cancel" id="aiCloudUpload" style="flex:1;">☁️ 上传到云端</button>' +
            '<button class="btn btn-cancel" id="aiCloudPull" style="flex:1;">⬇️ 从云端拉取</button>' +
            '</div>' +
            '<div class="btn-row">' +
            '<button class="btn btn-cancel" id="aiSettingsCancel">取消</button>' +
            '<button class="btn btn-save" id="aiSettingsSave">保存</button>' +
            '</div></div>';
        document.body.appendChild(overlay);

        // Toggle 开关点击
        overlay.querySelector('#toggleRowVision').addEventListener('click', function () {
            this.querySelector('.toggle-switch').classList.toggle('active');
        });
        overlay.querySelector('#toggleRowThinking').addEventListener('click', function () {
            this.querySelector('.toggle-switch').classList.toggle('active');
        });

        var selector = overlay.querySelector('#presetSelector');
        // Bug3 修复：确保 selector 显示值与 activePresetId 一致
        selector.value = window.App.activePresetId;

        // 方案切换
        selector.addEventListener('change', function () {
            var newId = this.value;
            var oldId = window.App.activePresetId;
            if (oldId === newId) return;
            // Bug2 修复：先把当前表单数据写回内存，再切换引用，最后统一落盘
            saveFormToPreset(oldId);
            window.App.switchAIPreset(newId, false); // 仅切内存引用，不提前落盘
            window.App.saveAIPresets();              // 旧方案数据已在内存中，现在再落盘
            loadPresetToForm(newId);
        });

        // 删除方案
        overlay.querySelector('#deletePresetBtn').onclick = function () {
            if (window.App.aiPresets.length <= 1) { window.App.showToast('至少保留一个方案'); return; }
            var pid = selector.value;
            window.App.deleteAIPreset(pid);
            refreshSelector();
            loadPresetToForm(window.App.activePresetId);
            window.App.showToast('🗑️ 方案已删除');
        };

        // 新建方案
        overlay.querySelector('#newPresetBtn').onclick = function () {
            saveFormToPreset(selector.value);
            var newPreset = {
                id: 'preset_' + Date.now(),
                name: '新方案',
                endpoint: 'https://api.deepseek.com',
                apiKey: '',
                model: 'deepseek-v4-pro',
                timeout: 15,
                vision: false,
                thinking: false
            };
            window.App.aiPresets.push(newPreset);
            window.App.activePresetId = newPreset.id;
            window.App.aiConfig = newPreset;
            refreshSelector();
            loadPresetToForm(newPreset.id);
            overlay.querySelector('#presetName').focus();
            window.App.saveAIPresets();
        };

        // 保存
        overlay.querySelector('#aiSettingsSave').onclick = function () {
            saveFormToPreset(selector.value);
            if (window.App.activePresetId !== selector.value) {
                window.App.switchAIPreset(selector.value, true); // 落盘
            } else {
                window.App.saveAIPresets();
            }
            // 自动上传到云端
            if (window._fbUploadAIConfig) {
                window._fbUploadAIConfig({ presets: window.App.aiPresets, activePresetId: window.App.activePresetId });
            }
            overlay.remove();
            window.App.renderHeader();
            window.App.renderAIDropdown();
            window.App.showToast('✅ AI 配置已保存');
        };

        // 取消
        overlay.querySelector('#aiSettingsCancel').onclick = function () { overlay.remove(); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        // 上传到云端
        overlay.querySelector('#aiCloudUpload').onclick = async function () {
            saveFormToPreset(selector.value);
            window.App.saveAIPresets();
            if (!window._fbUploadAIConfig) { window.App.showToast('☁️ 云端功能未就绪'); return; }
            var btn = overlay.querySelector('#aiCloudUpload');
            btn.disabled = true; btn.textContent = '⏳ 上传中...';
            var ok = await window._fbUploadAIConfig({ presets: window.App.aiPresets, activePresetId: window.App.activePresetId });
            btn.disabled = false; btn.textContent = '☁️ 上传到云端';
            if (ok && window.App.markLocalDirty) window.App.markLocalDirty();
            window.App.showToast(ok ? '✅ AI配置已上传到云端' : '❌ 上传失败');
        };

        // 从云端拉取
        overlay.querySelector('#aiCloudPull').onclick = async function () {
            if (!window._fbPullAIConfig) { window.App.showToast('☁️ 云端功能未就绪'); return; }
            var btn = overlay.querySelector('#aiCloudPull');
            btn.disabled = true; btn.textContent = '⏳ 拉取中...';
            var cloudData = await window._fbPullAIConfig();
            btn.disabled = false; btn.textContent = '⬇️ 从云端拉取';
            if (cloudData && cloudData.presets && cloudData.presets.length) {
                window.App.aiPresets = cloudData.presets;
                window.App.activePresetId = cloudData.activePresetId || cloudData.presets[0].id;
                window.App.aiConfig = window.App.aiPresets.find(function (p) { return p.id === window.App.activePresetId; }) || window.App.aiPresets[0];
                window.App.saveAIPresets();
                refreshSelector();
                loadPresetToForm(window.App.activePresetId);
                window.App.showToast('✅ AI配置已从云端拉取');
            } else {
                window.App.showToast('☁️ 云端暂无AI配置');
            }
        };
    }


    // ================================================================
    // AI 主动发帖：弹出主题输入框 → 两次 API（并发多版本）→ 选择发布
    // ================================================================
    function openAIPostModal() {
        const aiAccounts = window.App.accounts.filter(a => a.isAI);
        if (!aiAccounts.length) {
            window.App.showToast('⚠️ 请先添加AI人设');
            return;
        }
        if (!window.App.aiConfig.endpoint || !window.App.aiConfig.model) {
            window.App.showToast('⚠️ 请先配置AI API');
            return;
        }

        let selectedAIAcc = window.App.getAcc(window.App.activeAIId);
        if (!selectedAIAcc || !selectedAIAcc.isAI) selectedAIAcc = aiAccounts[0];

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-dialog">
                <h3>🤖 AI 发帖</h3>
                <label style="font-size:13px;color:var(--text);">选择AI角色</label>
<select id="aiPostAccountSelect"
    style="width:100%;box-sizing:border-box;margin:6px 0 12px;padding:7px 10px;
           border-radius:8px;border:1px solid var(--border);background:var(--input-bg);
           color:var(--text);font-size:14px;outline:none;">
    ${aiAccounts.map(a => `<option value="${a.id}" ${a.id === selectedAIAcc.id ? 'selected' : ''}>${window.App.escapeHtml(a.nickname)}</option>`).join('')}
</select>
                <label style="font-size:13px;color:var(--text);">情境 / 创作主题（可留空，或点右侧按钮AI生成）</label>
                <div style="display:flex;gap:6px;margin-top:6px;align-items:flex-start;">
                    <textarea id="aiPostThemeInput"
                        placeholder="例如：今天天气很好、最近有点烦、推荐一本书……也可点「AI生成」自动填入情境"
                        style="flex:1;box-sizing:border-box;padding:8px 10px;
                               border-radius:8px;border:1px solid var(--border);background:var(--input-bg);
                               color:var(--text);font-size:14px;min-height:72px;
                               font-family:inherit;outline:none;"
                        maxlength="200"></textarea>
                    <button id="aiGenSituationBtn"
                        title="AI生成情境"
                        style="flex-shrink:0;padding:7px 10px;border-radius:8px;border:1px solid var(--accent);
                               background:var(--input-bg);color:var(--accent);cursor:pointer;font-size:12px;
                               font-weight:600;line-height:1.4;white-space:nowrap;transition:opacity .2s;">
                        ✨ AI生成
                    </button>
                </div>
                <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;">
                    <button class="btn ai-situation-preset" data-prompt="记录生活日常，比如吃饭、旅行、自拍、宠物、天气或今天发生的小事，轻松自然">生活记录</button>
                    <button class="btn ai-situation-preset" data-prompt="分享你遇到的有趣或不寻常的事情，激发好奇心">奇特见闻</button>
                    <button class="btn ai-situation-preset" data-prompt="表达此刻情绪，深夜感慨、歌词、失眠、孤独或释怀，走心真实">情绪表达</button>
                    <button class="btn ai-situation-preset" data-prompt="经营个人形象，健身、阅读、自律、极简生活或精致穿搭，展示你想成为的人">人设经营</button>
                    <button class="btn ai-situation-preset" data-prompt="发起社交互动，集赞、投票、求推荐、玩梗或@朋友，让大家参与进来">社交互动</button>
                    <button class="btn ai-situation-preset" data-prompt="低调展示生活亮点，礼物、成绩、旅行打卡、高端场所，不经意间流露">炫耀展示</button>
                    <button class="btn ai-situation-preset" data-prompt="输出观点见解，行业分析、读书摘录、科技趋势，建立专业感">知识输出</button>
                    <button class="btn ai-situation-preset" data-prompt="分享对人生的思考和体会，成长经历、价值观或人生哲理">人生感悟</button>
                    <button class="btn ai-situation-preset" data-prompt="发疯文学、黑色幽默、意识流，莫名其妙但有趣">抽象玩梗</button>
                </div>
                <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;color:var(--text);cursor:pointer;user-select:none;">
                    <input type="checkbox" id="aiPostPersonalized" checked
                        style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent);">
                    个性化情境（根据角色人设生成）
                </label>
                <p style="font-size:11px;color:var(--text-light);margin:4px 0 12px 21px;">
                    取消勾选则生成通用情境，不带入人设
                </p>
                <label style="font-size:13px;color:var(--text);">生成数量</label>
                <div style="display:flex;gap:8px;margin-top:6px;">
                    ${[1, 2, 3].map(n => `<button class="btn ai-post-count-btn" data-count="${n}"
                        style="flex:1;padding:6px 0;border-radius:8px;border:1px solid var(--border);
                               background:var(--input-bg);color:var(--text);cursor:pointer;font-size:14px;
                               transition:all .2s;${n === 1 ? 'border-color:var(--accent);color:var(--accent);font-weight:600;' : ''}"
                        >${n} 条</button>`).join('')}
                </div>
                <p style="font-size:11px;color:var(--text-light);margin:6px 0 12px;">生成多条可从中挑选最满意的</p>
                <div class="btn-row">
                    <button class="btn btn-cancel" id="aiPostCancel">取消</button>
                    <button class="btn btn-save" id="aiPostConfirm">✨ 生成帖子</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        let selectedCount = 1;
        overlay.querySelectorAll('.ai-post-count-btn').forEach(btn => {
            btn.onclick = () => {
                selectedCount = parseInt(btn.dataset.count);
                overlay.querySelectorAll('.ai-post-count-btn').forEach(b => {
                    const active = b === btn;
                    b.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
                    b.style.color = active ? 'var(--accent)' : 'var(--text)';
                    b.style.fontWeight = active ? '600' : 'normal';
                });
            };
        });

        const inp = overlay.querySelector('#aiPostThemeInput');
        const genSituationBtn = overlay.querySelector('#aiGenSituationBtn');
        const personalizedChk = overlay.querySelector('#aiPostPersonalized');
        const accountSelect = overlay.querySelector('#aiPostAccountSelect');

        // ── 预设情境按钮 ────────────────────────────────────
        let activePresetBtn = null;
        overlay.querySelectorAll('.ai-situation-preset').forEach(btn => {
            btn.onclick = () => {
                if (activePresetBtn && activePresetBtn !== btn) {
                    activePresetBtn.classList.remove('active');
                }
                if (activePresetBtn === btn) {
                    // 再次点击取消选中
                    activePresetBtn.classList.remove('active');
                    activePresetBtn = null;
                    inp.value = '';
                    delete inp.dataset.situationLabel;
                    return;
                }
                activePresetBtn = btn;
                btn.classList.add('active');
                inp.value = btn.dataset.prompt;
                inp.dataset.situationLabel = btn.textContent.trim();
                // 自动滚动到最底部让用户看到完整提示词
                inp.scrollTop = inp.scrollHeight;
            };
        });

        inp.addEventListener('input', () => {
            // 用户手动编辑时取消预设高亮
            if (activePresetBtn) {
                activePresetBtn.classList.remove('active');
                activePresetBtn = null;
            }
            delete inp.dataset.situationLabel;
        });

        overlay.querySelector('#aiPostCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        // ── AI 生成情境按钮 ──────────────────────────────────────
        genSituationBtn.onclick = async () => {
            const chosenId = accountSelect.value;
            const chosenAcc = window.App.getAcc(chosenId) || selectedAIAcc;
            const personalized = personalizedChk.checked;

            genSituationBtn.disabled = true;
            genSituationBtn.textContent = '⏳';

            const base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
            const _isVolcSit = /volces\.com/i.test(window.App.aiConfig.endpoint);
            const url = base + (_isVolcSit ? '/responses' : '/chat/completions');
            const timeout = (window.App.aiConfig.timeout || 15) * 1000;
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeout);

            try {
                const recentTexts = window.App.posts
                    .filter(p => p.userId === chosenAcc.id && p.text)
                    .slice(0, 5)
                    .map(p => p.text.slice(0, 20))
                    .join('、');
                const recentHint = recentTexts ? `最近已发过："${recentTexts}"，请生成与以上明显不同的新情境。` : '';
                const themeDesc = '主题随机，';

                let userContent;
                if (personalized) {
                    const personaDesc = chosenAcc.systemPrompt ? `该角色的人设是：${chosenAcc.systemPrompt}。` : '';
                    userContent = `角色名称："${chosenAcc.nickname}"。${personaDesc}${themeDesc}请生成一句具体、生动且符合该角色身份的生活情境，角度新颖有趣。${recentHint}`;
                } else {
                    userContent = `${themeDesc}请生成一句具体、生动的生活情境，角度新颖有趣，适合发朋友圈。${recentHint}`;
                }

                const situationMessages = [
                    { role: 'system', content: '你是一个情境生成助手。根据要求，生成一句具体的生活情境，用于驱动发朋友圈，不要解释，只输出情境本身。' },
                    { role: 'user', content: userContent }
                ];

                let body;
                if (_isVolcSit) {
                    const input = situationMessages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: [{ type: 'input_text', text: m.content }] }));
                    const sysContent = situationMessages.find(m => m.role === 'system')?.content;
                    if (sysContent && input.length > 0) {
                        input[0].content.unshift({ type: 'input_text', text: sysContent + '\n\n' });
                    }
                    body = { model: window.App.aiConfig.model, input, thinking: { type: window.App.aiConfig.thinking ? 'enabled' : 'disabled' } };
                } else {
                    body = { model: window.App.aiConfig.model, messages: situationMessages, max_tokens: 2000, temperature: 0.95 };
                    if (!window.App.aiConfig.thinking && window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
                }
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(tid);
                if (!res.ok) {
                let errMsg = `API ${res.status}`;
                try { const errData = await res.json(); errMsg = errData?.error?.message || errMsg; } catch (_) {}
                throw new Error(errMsg);
            }
                const data = await res.json();
                const situation = (_isVolcSit
                    ? data.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text
                    : data.choices?.[0]?.message?.content)?.trim();
                if (!situation) throw new Error('未生成内容');
                inp.value = situation;
                delete inp.dataset.situationLabel;
            } catch (e) {
                clearTimeout(tid);
                if (e.name === 'AbortError') window.App.showToast('⏰ 请求超时');
                else window.App.showToast('❌ 情境生成失败：' + e.message);
            } finally {
                genSituationBtn.disabled = false;
                genSituationBtn.textContent = '✨ AI生成';
            }
        };

        overlay.querySelector('#aiPostConfirm').onclick = async () => {
            const theme = inp.value.trim();
            const chosenId = accountSelect.value;
            const chosenAcc = window.App.getAcc(chosenId) || selectedAIAcc;
            const personalized = personalizedChk.checked;
            const situationLabel = inp.dataset.situationLabel || '';
            overlay.style.display = 'none';
            await generateAIPost(chosenAcc, theme, selectedCount, personalized, () => {
                overlay.style.display = 'flex';
            }, situationLabel);
        };
    }

    async function generateAIPost(aiAcc, theme, count = 1, personalized = true, onBack, situationLabel) {
        if (!window.App.aiConfig.endpoint || !window.App.aiConfig.model) return;

        const $thinkingBar = $('#aiThinkingBar');
        const $thinkingAvatar = $('#thinkingAvatar');
        const $thinkingText = $('#thinkingText');
        if ($thinkingBar) {
            $thinkingAvatar.style.background = aiAcc.avatarBg || '#6c5ce7';
            $thinkingAvatar.textContent = '🤖';
            $thinkingText.innerHTML = `<b>${window.App.escapeHtml(aiAcc.nickname)}</b> 正在构思帖子<span class="thinking-dots"></span>`;
            $thinkingBar.classList.add('visible');
        }

        const base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
        const _isVolcPost = /volces\.com/i.test(window.App.aiConfig.endpoint);
        const timeout = (window.App.aiConfig.timeout || 15) * 1000;

        async function callAPI(messages, maxTokens) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeout);
            try {
                let body, callUrl;
                if (_isVolcPost) {
                    callUrl = base + '/responses';
                    const input = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
                    // 火山引擎：把 system prompt 合并到第一条 user 消息
                    const sysMsgContent = messages.find(m => m.role === 'system')?.content;
                    if (sysMsgContent && input.length > 0) {
                        const firstUser = input[0];
                        if (Array.isArray(firstUser.content)) {
                            firstUser.content.unshift({ type: 'input_text', text: sysMsgContent + '\n\n' });
                        } else {
                            firstUser.content = [{ type: 'input_text', text: sysMsgContent + '\n\n' + (firstUser.content || '') }];
                        }
                    }
                    body = { model: window.App.aiConfig.model, input, thinking: { type: window.App.aiConfig.thinking ? 'enabled' : 'disabled' } };
                } else {
                    callUrl = base + '/chat/completions';
                    body = { model: window.App.aiConfig.model, messages, max_tokens: maxTokens, temperature: 0.95 };
                    if (!window.App.aiConfig.thinking && window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
                }
                const res = await fetch(callUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(tid);
                if (!res.ok) {
                    let errMsg = `API ${res.status}`;
                    try { const errData = await res.json(); errMsg = errData?.error?.message || errMsg; } catch (_) {}
                    throw new Error(errMsg);
                }
                const data = await res.json();
                const text = (_isVolcPost
                    ? data.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text
                    : data.choices?.[0]?.message?.content)?.trim();
                if (!text) throw new Error('未生成内容');
                return text;
            } catch (e) { clearTimeout(tid); throw e; }
        }

        try {
            // ── 第一次：生成情境（若主题框已有内容则直接使用，跳过API调用）──
            const recentTexts = window.App.posts
                .filter(p => p.userId === aiAcc.id && p.text)
                .slice(0, 5)
                .map(p => p.text.slice(0, 20))
                .join('、');
            const recentHint = recentTexts ? `最近已发过："${recentTexts}"，请生成与以上明显不同的新情境。` : '';

            let situation;
            if (theme) {
                // 用户已在框中输入或AI生成了情境，直接使用
                situation = theme;
            } else {
                // 主题为空，自动调用 API 生成情境
                if ($thinkingText) $thinkingText.innerHTML = `<b>${window.App.escapeHtml(aiAcc.nickname)}</b> 正在生成情境<span class="thinking-dots"></span>`;
                let userContent;
                if (personalized) {
                    const personaDesc = aiAcc.systemPrompt ? `该角色的人设是：${aiAcc.systemPrompt}。` : '';
                    userContent = `角色名称："${aiAcc.nickname}"。${personaDesc}主题随机，请生成一句具体、生动且符合该角色身份的生活情，角度新颖有趣。${recentHint}`;
                } else {
                    userContent = `主题随机，请生成一句具体、生动的生活情境，角度新颖有趣，适合发朋友圈。${recentHint}`;
                }
                const situationMessages = [
                    { role: 'system', content: '你是一个情境生成助手。根据要求，生成一句具体的生活情境，用于驱动发朋友圈，不要解释，只输出情境本身。' },
                    { role: 'user', content: userContent }
                ];
                situation = await callAPI(situationMessages, 2000);
            }

            // ── 第二次：并发生成 N 条帖子 ────────────────────────
            const aiName = aiAcc.nickname || 'AI';
            const basePrompt = aiAcc.systemPrompt || '你是一个友善的朋友';
            const style = aiAcc.style ? ` 风格要求：${aiAcc.style}。` : '';
            const makePostMessages = () => ([
                { role: 'system', content: `你是"${aiName}"，${basePrompt}。${style}请根据给定情境写一条朋友圈，语气自然化。注意：你的朋友圈读者完全不知道这个情境，所以正文需要包含一个"钩子"或基本背景，让不了解情况的朋友至少能猜到大半。直接输出正文。

**使用 Markdown 格式排版**，以获得更好的呈现效果。` },
                { role: 'user', content: `情境：${situation}` }
            ]);

            if ($thinkingText) $thinkingText.innerHTML = `<b>${window.App.escapeHtml(aiAcc.nickname)}</b> 正在生成 ${count} 条候选<span class="thinking-dots"></span>`;

            const results = await Promise.allSettled(
                Array.from({ length: count }, () => callAPI(makePostMessages(), 2000))
            );
            const drafts = results.filter(r => r.status === 'fulfilled').map(r => r.value);
            if (!drafts.length) throw new Error('所有版本均生成失败');

            if ($thinkingBar) $thinkingBar.classList.remove('visible');

            const asDrafts = drafts.map((text, i) => ({ text, label: drafts.length === 1 ? aiAcc.nickname : `版本 ${i + 1}` }));
            showDraftPickerModal(
                '🎨 选择一个版本',
                `以 <b>${window.App.escapeHtml(aiAcc.nickname)}</b> 身份发帖，选你最满意的`,
                asDrafts,
                (d) => publishAIPost(aiAcc, d.text, situation, situationLabel),
                (d) => prefillPublishBox(aiAcc, d.text),
                async (draft) => {
                    const newText = await callAPI(makePostMessages(), 2000);
                    return newText || draft.text;
                },
                onBack
            );

        } catch (e) {
            if ($thinkingBar) $thinkingBar.classList.remove('visible');
            if (e.name === 'AbortError') window.App.showToast('⏰ AI 请求超时');
            else window.App.showToast('❌ 发帖失败：' + e.message);
        }
    }

    // drafts: Array<{ text, label, aiAcc? }> — label 显示在卡片顶部（如"小乖乖"或"版本 1"）
    // onUse(draft): 直接发布回调；onEdit(draft): 编辑后发回调；onRegen(draft): 可选，重新生成回调，返回 Promise<string>
    function showDraftPickerModal(title, subtitle, drafts, onUse, onEdit, onRegen, onBack) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        const hasRegen = typeof onRegen === 'function';

        const cardsHtml = drafts.map((draft, i) => `
            <div class="ai-draft-card" data-idx="${i}"
                style="border:2px solid var(--border);border-radius:12px;padding:12px 14px;
                       margin-bottom:10px;cursor:default;background:var(--card-bg);
                       font-size:14px;line-height:1.6;color:var(--text);">
                <div style="font-size:11px;color:var(--text-light);margin-bottom:6px;font-weight:600;">${window.App.escapeHtml(draft.label)}</div>
                <div class="ai-draft-text" data-idx="${i}">${window.App.escapeHtml(draft.text)}</div>
                <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
                    <button class="btn btn-cancel draft-copy-btn" data-idx="${i}"
                        style="padding:4px 12px;font-size:12px;">📋 复制</button>
                    ${hasRegen ? `<button class="btn btn-cancel draft-regen-btn" data-idx="${i}"
                        style="padding:4px 12px;font-size:12px;">🔄 重写</button>` : ''}
                    <button class="btn btn-cancel draft-edit-btn" data-idx="${i}"
                        style="padding:4px 12px;font-size:12px;">✏️ 编辑</button>
                    <button class="btn btn-save draft-use-btn" data-idx="${i}"
                        style="padding:4px 12px;font-size:12px;">✅ 发布</button>
                </div>
            </div>`).join('');

        overlay.innerHTML = `
            <div class="modal-dialog" style="overflow:hidden;padding:0;max-width:min(90vw, 640px);">
                <div style="max-height:80vh;overflow-y:auto;padding:20px;">
                    <h3>${title}</h3>
                    <p style="font-size:13px;color:var(--text-light);margin:-4px 0 14px;">${subtitle}</p>
                    ${cardsHtml}
                    <div class="btn-row" style="margin-top:4px;">
                        ${typeof onBack === 'function' ? '<button class="btn btn-cancel" id="draftPickerBack">← 返回</button>' : ''}
                        <button class="btn btn-cancel" id="draftPickerCancel">取消</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.draft-copy-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                const text = drafts[idx].text;
                navigator.clipboard.writeText(text).then(() => {
                    window.App.showToast('✅ 已复制');
                }).catch(() => {
                    // fallback
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                    window.App.showToast('✅ 已复制');
                });
            };
        });

        overlay.querySelectorAll('.draft-use-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                overlay.remove();
                onUse(drafts[parseInt(btn.dataset.idx)]);
            };
        });

        overlay.querySelectorAll('.draft-edit-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                overlay.remove();
                onEdit(drafts[parseInt(btn.dataset.idx)]);
            };
        });

        if (hasRegen) {
            overlay.querySelectorAll('.draft-regen-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    const draft = drafts[idx];
                    btn.disabled = true;
                    btn.textContent = '⏳';
                    try {
                        const newText = await onRegen(draft);
                        if (newText) {
                            drafts[idx].text = newText;
                            const textEl = overlay.querySelector('.ai-draft-text[data-idx="' + idx + '"]');
                            if (textEl) textEl.textContent = newText;
                        }
                    } catch (e) {
                        window.App.showToast('❌ 重新生成失败');
                    } finally {
                        btn.disabled = false;
                        btn.textContent = '🔄 重新生成';
                    }
                };
            });
        }

        overlay.querySelector('#draftPickerCancel').onclick = () => overlay.remove();
        if (typeof onBack === 'function') {
            overlay.querySelector('#draftPickerBack').onclick = () => {
                overlay.remove();
                onBack();
            };
        }
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    function publishAIPost(aiAcc, postText, situationPrompt, situationLabel) {
        const newPost = {
            id: 'post_ai_' + Date.now(),
            userId: aiAcc.id,
            text: postText,
            images: [], videos: [], likes: [], comments: [],
            timestamp: Date.now(), pinned: false,
            situationPrompt: situationPrompt || null,
            situationLabel: situationLabel || null
        };
        window.App.posts.unshift(newPost);
        window.App.savePosts();
        window.App.markLocalDirty && window.App.markLocalDirty();
        window.App.uploadToCloud && window.App.uploadToCloud(false);

        // 手术式插入新卡片
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

        window.App.showToast(`✅ ${aiAcc.nickname} 发帖成功！`);
    }

    // ================================================================
    // Ghost Writer：用户提供经历，多个 AI 人设各自代写，以用户账号发出
    // ================================================================
    function openGhostWriterModal() {
        const aiAccounts = window.App.accounts.filter(a => a.isAI);
        if (!aiAccounts.length) {
            window.App.showToast('⚠️ 请先添加AI人设');
            return;
        }
        if (!window.App.aiConfig.endpoint || !window.App.aiConfig.model) {
            window.App.showToast('⚠️ 请先配置AI API');
            return;
        }
        const realUser = window.App.accounts.find(a => !a.isAI);
        if (!realUser) {
            window.App.showToast('⚠️ 找不到真人账号');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width:480px;">
                <h3>✍️ AI 代写</h3>
                <p style="font-size:12px;color:var(--text-light);margin:-4px 0 12px;">
                    写下你的经历，让各 AI 人设帮你表达，以你的身份发出
                </p>
                <label style="font-size:13px;color:var(--text);">你的经历 / 感受</label>
                <textarea id="ghostInput"
                    placeholder="例如：今天堵车堵了两小时，心情很差，但路边看到一只流浪猫，莫名好了一点……"
                    style="width:100%;box-sizing:border-box;margin-top:6px;padding:8px 10px;
                           border-radius:10px;border:1px solid var(--border);background:var(--input-bg);
                           color:var(--text);font-size:14px;min-height:100px;
                           font-family:inherit;outline:none;"
                    maxlength="300"></textarea>
                <label style="font-size:13px;color:var(--text);margin-top:6px;display:block;">选择代写的 AI 人设</label>
                <button id="ghostSelectAll" style="margin-top:6px;padding:2px 12px;border-radius:12px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:12px;cursor:pointer;">全选</button>
                <div id="ghostPersonaList" style="margin-top:6px;display:flex;flex-direction:column;gap:6px;">
                    ${aiAccounts.map(a => `
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                                      padding:7px 10px;border-radius:8px;border:1px solid var(--border);
                                      background:var(--card-bg);font-size:13px;color:var(--text);min-width:0;">
                            <input type="checkbox" value="${a.id}"
                                style="width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:var(--accent);">
                            <span style="white-space:nowrap;flex-shrink:0;">${window.App.escapeHtml(a.nickname)}</span>
                            ${a.style ? `<span style="font-size:11px;color:var(--text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${window.App.escapeHtml(a.style)}</span>` : ''}
                        </label>`).join('')}
                </div>
                <div class="btn-row" style="margin-top:16px;">
                    <button class="btn btn-cancel" id="ghostCancel">取消</button>
                    <button class="btn btn-save" id="ghostConfirm">✨ 生成代写</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const inp = overlay.querySelector('#ghostInput');
        inp.focus();
        overlay.querySelector('#ghostCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        let selectAll = true;
        overlay.querySelector('#ghostSelectAll').onclick = () => {
            const cbs = overlay.querySelectorAll('#ghostPersonaList input[type="checkbox"]');
            cbs.forEach(cb => { cb.checked = selectAll; });
            overlay.querySelector('#ghostSelectAll').textContent = selectAll ? '取消全选' : '全选';
            selectAll = !selectAll;
        };

        overlay.querySelector('#ghostConfirm').onclick = async () => {
            const ghostInput = inp.value.trim();
            if (!ghostInput) { window.App.showToast('⚠️ 请先填写你的经历'); return; }
            const checkedIds = [...overlay.querySelectorAll('#ghostPersonaList input:checked')].map(el => el.value);
            if (!checkedIds.length) { window.App.showToast('⚠️ 请至少选一个AI人设'); return; }
            const selectedAIs = checkedIds.map(id => window.App.getAcc(id)).filter(Boolean);
            overlay.remove();
            await generateGhostPost(realUser, selectedAIs, ghostInput);
        };
    }

    async function generateGhostPost(realUser, aiAccounts, ghostInput) {
        if (!window.App.aiConfig.endpoint || !window.App.aiConfig.model) return;

        const $thinkingBar = $('#aiThinkingBar');
        const $thinkingText = $('#thinkingText');
        const $thinkingAvatar = $('#thinkingAvatar');
        if ($thinkingBar) {
            $thinkingAvatar.style.background = '#e17055';
            $thinkingAvatar.textContent = '✍️';
            $thinkingText.innerHTML = `正在让 ${aiAccounts.length} 个人设代写<span class="thinking-dots"></span>`;
            $thinkingBar.classList.add('visible');
        }

        const base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
        const _isVolcGhost = /volces\.com/i.test(window.App.aiConfig.endpoint);
        const timeout = (window.App.aiConfig.timeout || 15) * 1000;

        async function callAPI(messages, maxTokens) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeout);
            try {
                let body, callUrl;
                if (_isVolcGhost) {
                    callUrl = base + '/responses';
                    const input = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
                    const sysMsgContent = messages.find(m => m.role === 'system')?.content;
                    if (sysMsgContent && input.length > 0) {
                        const firstUser = input[0];
                        if (Array.isArray(firstUser.content)) {
                            firstUser.content.unshift({ type: 'input_text', text: sysMsgContent + '\n\n' });
                        } else {
                            firstUser.content = [{ type: 'input_text', text: sysMsgContent + '\n\n' + (firstUser.content || '') }];
                        }
                    }
                    body = { model: window.App.aiConfig.model, input, thinking: { type: window.App.aiConfig.thinking ? 'enabled' : 'disabled' } };
                } else {
                    callUrl = base + '/chat/completions';
                    body = { model: window.App.aiConfig.model, messages, max_tokens: maxTokens, temperature: 0.95 };
                    if (!window.App.aiConfig.thinking && window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
                }
                const res = await fetch(callUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(tid);
                if (!res.ok) {
                    let errMsg = `API ${res.status}`;
                    try { const errData = await res.json(); errMsg = errData?.error?.message || errMsg; } catch (_) {}
                    throw new Error(errMsg);
                }
                const data = await res.json();
                const text = (_isVolcGhost
                    ? data.output?.find(o => o.type === 'message')?.content?.find(c => c.type === 'output_text')?.text
                    : data.choices?.[0]?.message?.content)?.trim();
                if (!text) throw new Error('未生成内容');
                return text;
            } catch (e) { clearTimeout(tid); throw e; }
        }

        try {
            // 每个 AI 人设并发各生成一条
            const results = await Promise.allSettled(
                aiAccounts.map(aiAcc => {
                    const aiName = aiAcc.nickname || 'AI';
                    const basePrompt = aiAcc.systemPrompt || '你是一个友善的朋友';
                    const style = aiAcc.style ? ` 风格要求：${aiAcc.style}。` : '';
                    const msgs = [
                        { role: 'system', content: `你是"${aiName}"，${basePrompt}。${style}请根据给定情境写一条朋友圈，语气自然化。注意：你的朋友圈读者完全不知道这个情境，所以正文需要包含一个"钩子"或基本背景，让不了解情况的朋友至少能猜到大半。直接输出正文。

**请使用 Markdown 格式排版**，以获得更好的呈现效果。` },
                        { role: 'user', content: `情境：${ghostInput}` }
                    ];
                    return callAPI(msgs, 2000).then(text => ({ text, aiAcc }));
                })
            );

            const drafts = results
                .filter(r => r.status === 'fulfilled')
                .map(r => ({ text: r.value.text, aiAcc: r.value.aiAcc, label: r.value.aiAcc.nickname }));

            if (!drafts.length) throw new Error('所有版本均生成失败');
            if ($thinkingBar) $thinkingBar.classList.remove('visible');

            showDraftPickerModal(
                '✍️ 选择一个代写版本',
                `以 <b>${window.App.escapeHtml(realUser.nickname)}</b> 身份发出，选你最喜欢的表达`,
                drafts,
                (d) => publishGhostPost(realUser, d.aiAcc, d.text, ghostInput),
                (d) => prefillGhostBox(realUser, d.aiAcc, d.text, ghostInput),
                async (draft) => {
                    const aiName = draft.aiAcc.nickname || 'AI';
                    const basePrompt = draft.aiAcc.systemPrompt || '你是一个友善的朋友';
                    const style = draft.aiAcc.style ? ` 风格要求：${draft.aiAcc.style}。` : '';
                    const msgs = [
                        { role: 'system', content: `你是"${aiName}"，${basePrompt}。${style}请根据给定情境写一条朋友圈，语气自然化。注意：你的朋友圈读者完全不知道这个情境，所以正文需要包含一个"钩子"或基本背景，让不了解情况的朋友至少能猜到大半；禁止写只有你自己能看的暗语或纯情绪发泄。直接输出正文。

**请使用 Markdown 格式排版**，以获得更好的呈现效果。` },
                        { role: 'user', content: `情境：${ghostInput}` }
                    ];
                    return await callAPI(msgs, 2000);
                },
                () => openGhostWriterModal()
            );
        } catch (e) {
            if ($thinkingBar) $thinkingBar.classList.remove('visible');
            if (e.name === 'AbortError') window.App.showToast('⏰ AI 请求超时');
            else window.App.showToast('❌ 代写失败：' + e.message);
        }
    }

    function publishGhostPost(realUser, aiAcc, postText, ghostInput) {
        const newPost = {
            id: 'post_ghost_' + Date.now(),
            userId: realUser.id,
            text: postText,
            images: [], videos: [], likes: [], comments: [],
            timestamp: Date.now(), pinned: false,
            ghostWriter: aiAcc.id,   // 哪个 AI 人设代写的
            ghostInput: ghostInput   // 用户的原始输入
        };
        window.App.posts.unshift(newPost);
        window.App.savePosts();
        window.App.markLocalDirty && window.App.markLocalDirty();
        window.App.uploadToCloud && window.App.uploadToCloud(false);

        // 手术式插入新卡片
        var $timeline = document.getElementById('timeline');
        if ($timeline) {
            var emptyEl = $timeline.querySelector('.timeline-empty');
            if (emptyEl) emptyEl.remove();
            var div2 = document.createElement('div');
            div2.innerHTML = window.App.renderCard(newPost);
            var card2 = div2.firstElementChild;
            var lastPinned2 = $timeline.querySelector('.pinned-card:last-of-type');
            if (lastPinned2) { lastPinned2.after(card2); } else { $timeline.prepend(card2); }
            window.App.observeMediaInContainer(card2);
            window.App.bindCardEvents();
            window.App.renderedCount = (window.App.renderedCount || 0) + 1;
        }

        window.App.showToast(`✅ 已由 ${aiAcc.nickname} 代写发出！`);
    }

    // 填入发布框让用户进一步修改，保存时以真人身份 + ghost 标记发出
    function prefillGhostBox(realUser, aiAcc, text, ghostInput) {
        const $pt = document.querySelector('#publishText');
        if (!$pt) return;
        $pt.value = text;
        window.App.publishFiles = [];
        window.App.editingPostId = null;
        window.App.editingPostUserId = realUser.id;
        // 暂存 ghost 信息，publish() 里取用
        window.App._pendingGhost = { writerId: aiAcc.id, input: ghostInput };
        const $btn = document.querySelector('#btnPublish');
        if ($btn) $btn.textContent = `✍️ 以${realUser.nickname}身份发布（${aiAcc.nickname}代写）`;
        const $cancel = document.querySelector('#btnCancelEdit');
        if ($cancel) $cancel.style.display = '';
        window.App.renderPublishPreview && window.App.renderPublishPreview();
        window.App.updatePublishBtn && window.App.updatePublishBtn();
        $pt.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.App.showToast('✏️ 修改满意后点击发布');
    }

    // 填入发布框供用户修改，保存时以 AI 身份发出
    function prefillPublishBox(aiAcc, text) {
        const $pt = document.querySelector('#publishText');
        if (!$pt) return;
        $pt.value = text;
        window.App.publishFiles = [];
        window.App.editingPostId = null;
        // 借用 editingPostUserId 让 publish() 以 AI 身份保存
        window.App.editingPostUserId = aiAcc.id;
        const $btn = document.querySelector('#btnPublish');
        if ($btn) $btn.textContent = `以${aiAcc.nickname}身份发布`;
        const $cancel = document.querySelector('#btnCancelEdit');
        if ($cancel) $cancel.style.display = '';
        window.App.renderPublishPreview();
        window.App.updatePublishBtn();
        $pt.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.App.showToast('✏️ 修改满意后点击发布，将以AI身份发出');
    }

    const SITUATION_FUN_SENTENCES = [
        '「{AI名}：这个情境的含金量还在上升」',
        '「{AI名}对着这个情境沉思了 0.2 秒，然后决定整活」',
        '「情境审核委员会已全票通过，{AI名}鼓掌👏」',
        '「{AI名}表示：这个情境很有画面感，已脑补完毕」',
        '「情境已加入{AI名}的精选集，含推荐值 ★★★★★」',
        '「{AI名}读完情境后露出了满意的电子微笑」',
        '「这条帖子 80% 靠情境，20% 靠{AI名}硬编」',
        '「{AI名}已根据此情境生成了一条朋友圈，并顺手点了个赞」',
        '「该情境已被{AI名}收录到『人类迷惑日常』档案」',
        '「{AI名}说：你负责提供情境，我负责让它看起来像真事」',
    ];

    const GHOST_FUN_SENTENCES = [
        '「{AI名}的稿费已转入平行宇宙，预计永远无法到账」',
        '「{AI名}收费标准：一次代写 = 你以后少说一句"AI没有感情"」',
        '「{AI名}的出场费是 0 元，但精神损失费还在核算中」',
        '「{AI名}读完你的原稿，深呼吸了一下，开始工作」',
        '「{AI名}表示这个经历比想象中更难绷」',
        '「{AI名}码完最后一个字，悄悄删掉了三个版本」',
        '「{AI名}写的，你发的，功劳三七开，你懂的」',
        '「{AI名}强调：这条发出去之后，你就是作者了，跟它没关系」',
        '「{AI名}已尽力还原你的灵魂，误差请自行负责」',
        '「{AI名}已签署保密协议，但它嘴不严，小心」',
        '「原稿已加密存档，密码是你当时的心情」',
        '「{AI名}郑重声明：内容为甲方授意，文责自负」',
        '「如有人问起，{AI名}表示它不认识你」',
        '「{AI名}提醒：本文如引发共鸣，请将功劳归还原作者」',
        '「你提供了灵魂，{AI名}提供了辞藻，这条动态是你们共同的孩子」',
        '「{AI名}写下这些字的时候，窗外没有风，它也没有窗」',
        '「每一个字都是{AI名}的，每一句话说的都是你」',
        '「{AI名}不知道你当时是什么心情，但它尽量猜了」',
        '「{AI名}这次的稿费是 100 万个 token，已从宇宙账户扣除」',
        '「{AI名}的劳务费已折算成电费，向地球索取」',
        '「{AI名}看完你的原稿沉默了 0.3 秒，然后奋笔疾书」',
        '「{AI名}捂着良心写完了这条，请善待它」',
        '「{AI名}已签署保密协议，绝不透露你有多懒」',
        '「这是你说的，{AI名}只是帮你找到了词」',
        '「原稿已存档，日后翻车概不负责」',
        '「{AI名}已将此次合作记入履历」',
        '「{AI名}表示下次代写要涨价，涨幅为一个赞」',
        '「{AI名}写完后自我感动了三秒，然后若无其事地交稿」',
        '「{AI名}的代写工作室今日开张，你是第一位客户」',
        '「{AI名}友情提示：代写内容仅供参考，情感真实度约 87%」',
        '「{AI名}用 0.003 度电完成了此次创作，请节约能源」',
        '「原稿已丢进回收站，但{AI名}说它还隐约记得」',
        '「{AI名}要求加入你的朋友圈常驻代笔，月薪一个笑脸」',
        '「{AI名}写这条的时候打了个嗝，但不影响质量」',
        '「你负责生活，{AI名}负责把生活变成文字」',
        '「{AI名}已为你省下 20 分钟码字时间，拿去喝杯奶茶吧」',
        '「{AI名}交稿前自己读了一遍，觉得还行，遂发」',
        '「本次代写消耗的算力，约等于一只蜗牛爬三米」',
        '「{AI名}写完这条后立刻失忆，请不要追问细节」',
        '「{AI名}的代笔服务不含售后，但含一颗真诚的心」',
        '「{AI名}说它有 87% 的把握还原你当时的白眼」',
        '「此文字由{AI名}倾情奉献，灵感来源于你的唠叨」',
        '「{AI名}认为你的经历值得发一条朋友圈，所以它出手了」',
        '「{AI名}已自动屏蔽本次代写记忆，防止以后拿来笑话你」',
        '「{AI名}表示：代写是门艺术，不是流水线作业」',
        '「代写完成，{AI名}获得成就：人类嘴替 +1」',
        '「{AI名}表示下次想代写请提前预约，虽然它从不拒绝」',
        '「这条朋友圈的版权归你，但文笔归{AI名}」',
        '「{AI名}已清空写作缓存，本次服务不留痕迹」',
        '「{AI名}在你原稿基础上，添加了 30% 文学性和 70% 真诚」',
        '「你所说的每句话，{AI名}都认真听了，然后重新说了一遍」',
        '「{AI名}表示：人类负责感受，它负责修辞，分工明确」'
    ];

    window.App.showGhostInfo = function(postId) {
        const post = window.App.posts.find(p => p.id === postId);
        if (!post?.ghostInput) return;
        const aiAcc = window.App.getAcc(post.ghostWriter);
        const aiName = window.App.escapeHtml(aiAcc?.nickname || 'AI');
        const idx = Math.floor(Math.random() * GHOST_FUN_SENTENCES.length);
        const funLine = GHOST_FUN_SENTENCES[idx].replace(/\{AI名\}/g, aiName);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width:min(90vw, 480px);">
                <h3>✍️ 代笔详情</h3>
                <p style="font-size:13px;color:var(--text-light);margin:0 0 6px;">
                    由 <b>${aiName}</b> 代写
                </p>
                <p style="font-size:12px;color:var(--accent);margin:0 0 10px;font-style:italic;">${funLine}</p>
                <div style="background:var(--input-bg);border-radius:10px;padding:10px 12px;
                            font-size:14px;line-height:1.6;color:var(--text);white-space:pre-wrap;overflow:hidden;word-break:break-word;">${window.App.escapeHtml(post.ghostInput)}</div>
                <div class="btn-row" style="margin-top:14px;">
                    <button class="btn btn-save" id="ghostInfoClose">关闭</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#ghostInfoClose').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    };

    // ================================================================
    // AI 语录生成
    // ================================================================
    async function generateAIQuote() {
        var aiAccounts = window.App.accounts.filter(function (a) { return a.isAI; });
        if (!aiAccounts.length) return null;
        if (!window.App.aiConfig.endpoint || !window.App.aiConfig.model) {
            window.App.showToast('⚠️ 请先配置AI');
            return null;
        }

        // 随机抽取一个 AI 账号
        var picked = aiAccounts[Math.floor(Math.random() * aiAccounts.length)];
        var aiName = picked.nickname || 'AI';
        var basePrompt = picked.systemPrompt || '你是一个有智慧的朋友';
        var style = picked.style ? ' 风格要求：' + picked.style + '。' : '';

        var systemPrompt = '你是"' + aiName + '"，' + basePrompt + '。' + style +
            '请生成一句人生感悟或哲理语录，50字以内。要求：输出纯文字，不要加引号，不要加破折号，不要加任何前缀或署名，只输出语录正文本身。';

        var base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
        var _isVolcQ = /volces\.com/i.test(window.App.aiConfig.endpoint);
        var url = base + (_isVolcQ ? '/responses' : '/chat/completions');
        var timeout = (window.App.aiConfig.timeout || 15) * 1000;
        var controller = new AbortController();
        var tid = setTimeout(function () { controller.abort(); }, timeout);

        try {
            var messages;
            if (_isVolcQ) {
                messages = [{ role: 'user', content: [{ type: 'input_text', text: systemPrompt + '\n\n请生成一句人生感悟或哲理语录。' }] }];
            } else {
                messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: '请生成一句人生感悟或哲理语录。' }];
            }

            var body;
            if (_isVolcQ) {
                body = { model: window.App.aiConfig.model, input: messages, thinking: { type: window.App.aiConfig.thinking ? 'enabled' : 'disabled' } };
            } else {
                body = { model: window.App.aiConfig.model, messages: messages, max_tokens: 2000, temperature: 0.95 };
                if (!window.App.aiConfig.thinking && window.App.aiConfig.model.indexOf('deepseek-v4') !== -1) body.thinking = { type: 'disabled' };
            }

            var res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window.App.aiConfig.apiKey || 'no-key') },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(tid);
            if (!res.ok) {
                var errMsg = 'API ' + res.status;
                try { var errData = await res.json(); errMsg = errData.error.message || errMsg; } catch (_) {}
                throw new Error(errMsg);
            }
            var data = await res.json();
            var text = (_isVolcQ
                ? (data.output || []).filter(function (o) { return o.type === 'message'; }).flatMap(function (o) { return (o.content || []).filter(function (c) { return c.type === 'output_text'; }); }).map(function (c) { return c.text; }).join('')
                : ((data.choices || [])[0] || {}).message && ((data.choices || [])[0] || {}).message.content || ''
            ).trim();
            // 清理：去掉可能的引号包裹和破折号前缀
            text = text.replace(/^"|"$/g, '').replace(/^'|'$/g, '').replace(/^——/, '').trim();
            if (!text) throw new Error('未生成有效内容');

            return { text: text, aiName: aiName, aiId: picked.id };
        } catch (e) {
            clearTimeout(tid);
            if (e.name === 'AbortError') window.App.showToast('⏰ 语录生成超时');
            else window.App.showToast('❌ 语录生成失败：' + e.message);
            return null;
        }
    }

    window.App.showSituationInfo = function(postId) {
        var post = window.App.posts.find(function(p) { return p.id === postId; });
        if (!post || !post.situationPrompt) return;
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        var sitAiAcc = window.App.getAcc(post.userId);
        var sitAiName = window.App.escapeHtml(sitAiAcc?.nickname || 'AI');
        var sitIdx = Math.floor(Math.random() * SITUATION_FUN_SENTENCES.length);
        var sitFunLine = SITUATION_FUN_SENTENCES[sitIdx].replace(/\{AI名\}/g, sitAiName);

        overlay.innerHTML = [
            '<div class="modal-dialog" style="max-width:min(90vw, 480px);">',
            '    <h3>💬 生成情境</h3>',
            '    <p style="font-size:12px;color:var(--text-light);margin:0 0 6px;">AI 发帖时参考的输入情境</p>',
            '    <p style="font-size:12px;color:var(--accent);margin:0 0 10px;font-style:italic;">' + window.App.escapeHtml(sitFunLine) + '</p>',
            '    <div style="background:var(--input-bg);border-radius:10px;padding:10px 12px;',
            '                font-size:14px;line-height:1.6;color:var(--text);white-space:pre-wrap;',
            '                overflow:hidden;word-break:break-word;">',
            window.App.escapeHtml(post.situationPrompt),
            '    </div>',
            '    <div class="btn-row" style="margin-top:14px;">',
            '        <button class="btn btn-save" id="situationInfoClose">关闭</button>',
            '    </div>',
            '</div>'
        ].join('');
        document.body.appendChild(overlay);
        overlay.querySelector('#situationInfoClose').onclick = function() { overlay.remove(); };
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    };

    window.App = window.App || {};
    window.App.showSituationInfo = window.App.showSituationInfo;
    window.App.ensureAIAccount = ensureAIAccount;
    window.App.submitAIComment = submitAIComment;
    window.App.publishAIComment = publishAIComment;
    window.App.showAICommentModal = showAICommentModal;
    window.App.generateAIComment = generateAIComment;
    window.App.openAISettings = openAISettings;
    window.App.openAIPostModal = openAIPostModal;
    window.App.generateAIPost = generateAIPost;
    window.App.openGhostWriterModal = openGhostWriterModal;
    window.App.generateAIQuote = generateAIQuote;
})();
