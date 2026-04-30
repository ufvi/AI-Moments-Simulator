(function () {
    const $ = (s) => document.querySelector(s);

    function ensureAIAccount() {
        // 兼容旧版单一 AI 账号（id='acc_ai'），为其打上 isAI 标记
        window.App.accounts.filter(a => a.id === 'acc_ai').forEach(a => { a.isAI = true; });

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
        window.App.updateCard(id);
        window.App.showToast('🤖 AI 已评论');
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
                if (btn) { btn.disabled = false; btn.textContent = '🤖 生成'; }
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
        const modelSupportsVision = /vision|vl|claude|gemini|gpt-4o/i.test(window.App.aiConfig.model);

        // ===== 收集图片URL（仅当模型支持视觉时） =====
        let imageUrls = [];
        if (modelSupportsVision && (post.images?.length || /!\[[^\]]*\]\(/.test(post.text))) {
            const collected = [];

            // 1. 直接上传的图片（从images数组获取Firebase Storage URL）
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
        const fixedSuffix = '，请用简短的口语为朋友圈生成评论。';
        let systemPrompt = `你是"${aiName}"，${basePrompt}。你需要严格遵守你的独立人设，不要将其他用户的评论当成你的发言。${fixedSuffix}`;
        systemPrompt += `直接给出评论内容，不要在评论前加上"${aiName}："或类似称呼。`;
        const activeStyle = selectedAIAcc?.style || '';
        if (activeStyle) systemPrompt += ` 你的评论风格要：${activeStyle}。`;

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
            : ' 请以你的身份写一句评论。';

        // ===== 构造 user 消息（多模态 vs 纯文本） =====
        if (imageUrls.length > 0) {
            // 视觉模式：content 为数组
            const contentArray = [{ type: 'text', text: contentDesc }];
            imageUrls.forEach(url => {
                contentArray.push({ type: 'image_url', image_url: { url } });
            });
            messages.push({ role: 'user', content: contentArray });
        } else {
            // 纯文本模式
            messages.push({ role: 'user', content: contentDesc });
        }

        // ===== 3. 安全地添加历史对话 =====
        if (post.comments.length) {
            const recent = post.comments.slice(-15);
            const myComments = recent.filter(c => c.userId === selectedAIId);
            const otherComments = recent.filter(c => c.userId !== selectedAIId);

            if (otherComments.length) {
                let othersText = otherComments
                    .map(c => `${window.App.getAcc(c.userId)?.nickname || '用户'}：${c.text}`)
                    .join('\n');
                messages.push({
                    role: 'user',
                    content: `已有的其他用户评论：\n${othersText}`
                });
            }

            if (myComments.length) {
                let myText = myComments.map(c => c.text).join('\n');
                messages.push({
                    role: 'assistant',
                    content: myText
                });
            }
        }

        // ===== 4. 调用 API =====
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), (window.App.aiConfig.timeout || 15) * 1000);
        try {
            const body = { model: window.App.aiConfig.model, messages, max_tokens: 150, temperature: 0.8 };
            if (window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
            const base = window.App.aiConfig.endpoint.replace(/\/ +$/, '');
            const url = base + '/chat/completions';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`API ${res.status}`);
            const data = await res.json();
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (!reply) throw new Error('未生成有效回复');

            const inp = document.getElementById('commentInput-' + postId);
            if (inp) {
                inp.value = reply;
                inp.dataset.fromAI = 'true';
                inp.focus();
                window.App.showToast(window.App.randomAIMode ? `🎲 以 ${selectedAIAcc.nickname} 身份生成，可修改后点🤖发送` : '🤖 已生成，可修改后点🤖发送');
            }
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') window.App.showToast('⏰ AI 请求超时');
            else window.App.showToast('❌ ' + e.message);
        } finally {
            if ($thinkingBar) $thinkingBar.classList.remove('visible');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🤖 生成';
            }
            if (window.App.randomAIMode) {
                window.App.renderHeader();
                window.App.renderAIDropdown();
            }
        }
    }

    function openAISettings() {
        $('#aiSettingsModal').style.display = 'flex';
        $('#aiEndpoint').value = window.App.aiConfig.endpoint || '';
        $('#aiApiKey').value = window.App.aiConfig.apiKey || '';
        $('#aiModel').value = window.App.aiConfig.model || '';
        $('#aiTimeout').value = window.App.aiConfig.timeout || 15;
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
            <div class="modal-dialog" style="max-width:340px;">
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
                               color:var(--text);font-size:14px;resize:vertical;min-height:72px;
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

        inp.focus();
        overlay.querySelector('#aiPostCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        // ── AI 生成情境按钮 ──────────────────────────────────────
        genSituationBtn.onclick = async () => {
            const chosenId = accountSelect.value;
            const chosenAcc = window.App.getAcc(chosenId) || selectedAIAcc;
            const themeHint = inp.value.trim();
            const personalized = personalizedChk.checked;

            genSituationBtn.disabled = true;
            genSituationBtn.textContent = '⏳';

            const base = window.App.aiConfig.endpoint.replace(/\/+$/, '');
            const url = base + '/chat/completions';
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
                const themeDesc = themeHint ? `方向是"${themeHint}"，` : '主题随机，';

                let userContent;
                if (personalized) {
                    const personaDesc = chosenAcc.systemPrompt ? `该角色的人设是：${chosenAcc.systemPrompt}。` : '';
                    userContent = `角色名称："${chosenAcc.nickname}"。${personaDesc}${themeDesc}请生成一句具体、生动且符合该角色身份的生活情境（20字以内），角度新颖有趣，避免过于日常普通。${recentHint}`;
                } else {
                    userContent = `${themeDesc}请生成一句具体、生动的生活情境（20字以内），角度新颖有趣，适合发朋友圈，避免过于日常普通。${recentHint}`;
                }

                const situationMessages = [
                    { role: 'system', content: '你是一个情境生成助手。根据要求，生成一句具体的生活情境，用于驱动发朋友圈，不要解释，只输出情境本身。' },
                    { role: 'user', content: userContent }
                ];

                const body = { model: window.App.aiConfig.model, messages: situationMessages, max_tokens: 60, temperature: 0.95 };
                if (window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(tid);
                if (!res.ok) throw new Error(`API ${res.status}`);
                const data = await res.json();
                const situation = data.choices?.[0]?.message?.content?.trim();
                if (!situation) throw new Error('未生成内容');
                inp.value = situation;
                inp.focus();
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
            overlay.remove();
            await generateAIPost(chosenAcc, theme, selectedCount, personalized);
        };
    }

    async function generateAIPost(aiAcc, theme, count = 1, personalized = true) {
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
        const url = base + '/chat/completions';
        const timeout = (window.App.aiConfig.timeout || 15) * 1000;

        async function callAPI(messages, maxTokens) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeout);
            try {
                const body = { model: window.App.aiConfig.model, messages, max_tokens: maxTokens, temperature: 0.95 };
                if (window.App.aiConfig.model?.includes('deepseek-v4')) body.thinking = { type: 'disabled' };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.App.aiConfig.apiKey || 'no-key'}` },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(tid);
                if (!res.ok) throw new Error(`API ${res.status}`);
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content?.trim();
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
                    userContent = `角色名称："${aiAcc.nickname}"。${personaDesc}主题随机，请生成一句具体、生动且符合该角色身份的生活情境（20字以内），角度新颖有趣，避免过于日常普通。${recentHint}`;
                } else {
                    userContent = `主题随机，请生成一句具体、生动的生活情境（20字以内），角度新颖有趣，适合发朋友圈，避免过于日常普通。${recentHint}`;
                }
                const situationMessages = [
                    { role: 'system', content: '你是一个情境生成助手。根据要求，生成一句具体的生活情境，用于驱动发朋友圈，不要解释，只输出情境本身。' },
                    { role: 'user', content: userContent }
                ];
                situation = await callAPI(situationMessages, 60);
            }

            // ── 第二次：并发生成 N 条帖子 ────────────────────────
            const aiName = aiAcc.nickname || 'AI';
            const basePrompt = aiAcc.systemPrompt || '你是一个友善的朋友';
            const style = aiAcc.style ? ` 风格要求：${aiAcc.style}。` : '';
            const makePostMessages = () => ([
                { role: 'system', content: `你是"${aiName}"，${basePrompt}。${style}请根据给定情境写一条朋友圈，语气自然口语化，不超过150字。注意：你的朋友圈读者完全不知道这个情境，所以正文需要包含一个"钩子"或基本背景，让不了解情况的朋友至少能猜到大半；禁止写只有你自己能看懂的暗语或纯情绪发泄。直接输出正文。` },
                { role: 'user', content: `情境：${situation}` }
            ]);

            if ($thinkingText) $thinkingText.innerHTML = `<b>${window.App.escapeHtml(aiAcc.nickname)}</b> 正在生成 ${count} 条候选<span class="thinking-dots"></span>`;

            const results = await Promise.allSettled(
                Array.from({ length: count }, () => callAPI(makePostMessages(), 200))
            );
            const drafts = results.filter(r => r.status === 'fulfilled').map(r => r.value);
            if (!drafts.length) throw new Error('所有版本均生成失败');

            if ($thinkingBar) $thinkingBar.classList.remove('visible');

            if (drafts.length === 1) {
                publishAIPost(aiAcc, drafts[0]);
            } else {
                showDraftPickerModal(aiAcc, drafts);
            }

        } catch (e) {
            if ($thinkingBar) $thinkingBar.classList.remove('visible');
            if (e.name === 'AbortError') window.App.showToast('⏰ AI 请求超时');
            else window.App.showToast('❌ 发帖失败：' + e.message);
        }
    }

    function showDraftPickerModal(aiAcc, drafts) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        const cardsHtml = drafts.map((text, i) => `
            <div class="ai-draft-card" data-idx="${i}"
                style="border:2px solid var(--border);border-radius:12px;padding:12px 14px;
                       margin-bottom:10px;cursor:default;background:var(--card-bg);
                       font-size:14px;line-height:1.6;color:var(--text);">
                <div style="font-size:11px;color:var(--text-light);margin-bottom:6px;font-weight:600;">版本 ${i + 1}</div>
                <div>${window.App.escapeHtml(text)}</div>
                <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-cancel draft-edit-btn" data-idx="${i}"
                        style="padding:4px 12px;font-size:12px;">✏️ 编辑后发</button>
                    <button class="btn btn-save draft-use-btn" data-idx="${i}"
                        style="padding:4px 12px;font-size:12px;">✅ 直接发布</button>
                </div>
            </div>`).join('');

        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width:400px;max-height:80vh;overflow-y:auto;">
                <h3>🎨 选择一个版本</h3>
                <p style="font-size:13px;color:var(--text-light);margin:-4px 0 14px;">
                    以 <b>${window.App.escapeHtml(aiAcc.nickname)}</b> 身份发帖，选你最满意的
                </p>
                ${cardsHtml}
                <div class="btn-row" style="margin-top:4px;">
                    <button class="btn btn-cancel" id="draftPickerCancel">取消</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.draft-use-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                overlay.remove();
                publishAIPost(aiAcc, drafts[parseInt(btn.dataset.idx)]);
            };
        });

        overlay.querySelectorAll('.draft-edit-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                overlay.remove();
                prefillPublishBox(aiAcc, drafts[parseInt(btn.dataset.idx)]);
            };
        });

        overlay.querySelector('#draftPickerCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    function publishAIPost(aiAcc, postText) {
        const newPost = {
            id: 'post_ai_' + Date.now(),
            userId: aiAcc.id,
            text: postText,
            images: [], videos: [], likes: [], comments: [],
            timestamp: Date.now(), pinned: false
        };
        window.App.posts.unshift(newPost);
        window.App.savePosts();
        window.App.markLocalDirty && window.App.markLocalDirty();
        window.App.uploadToCloud && window.App.uploadToCloud(false);
        window.App.renderTimeline(true);
        window.App.showToast(`✅ ${aiAcc.nickname} 发帖成功！`);
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

    window.App = window.App || {};
    window.App.ensureAIAccount = ensureAIAccount;
    window.App.submitAIComment = submitAIComment;
    window.App.generateAIComment = generateAIComment;
    window.App.openAISettings = openAISettings;
    window.App.openAIPostModal = openAIPostModal;
    window.App.generateAIPost = generateAIPost;
})();
