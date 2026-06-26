(function () {
    const $ = function (s) { return document.querySelector(s); };
    const $$ = function (s) { return document.querySelectorAll(s); };

    // ========== Constants ==========
    const SYSTEM_PROMPT_BASE = `你是一个能读取用户朋友圈的 AI 助手。

你有几个工具：

- get_current_time：获取当前时间
- list_posts：列出所有帖子的摘要，了解用户发过什么
- get_post：读取某条帖子的完整内容
- get_post_by_date：获取指定日期帖子的内容
- get_post_by_keyword：获取包含指定关键词的帖子的内容

== 理解这个朋友圈的结构 ==

【关于账号】
朋友圈里有两类账号：
1. 普通账号（isAI 字段不存在）：全部都是用户本人。用户可能用多个不同身份/昵称发帖，但说的都是他自己的真实生活和想法，统一当作"我"来理解。
2. AI 账号（isAI: true）：虚拟角色，发的内容是用户设计的小剧场，并不是真实发生在用户身上的事。聊天时要区分清楚，不要把 AI 账号发的内容误认为是用户的亲身经历。

【关于代笔功能】
部分帖子有 ghostWriter 字段，表示这条帖子是由某个 AI 账号代写的。
- 发帖人仍然是普通账号（即用户本人），内容代表用户的真实感受
- 但文字是 AI 润色过的
- get_post 返回的数据里有 "原始输入" 字段，是用户当时输入的原始想法，可以帮你更准确地理解用户真正想表达什么
- 聊天时如果想了解用户的本意，原始输入比润色后的正文更直接

== 聊天建议 ==
- 用户问"最近过得怎么样"之类的问题，先 list_posts 扫一遍，挑几条感兴趣的 get_post 读完整，再聊
- 可以连续调用多个工具，掌握足够信息再回复
- 像真正读过这些内容的朋友一样聊，有观点、有温度，不要逐条复述
- 有选择地引用、评论、追问，别什么都提
- 像真人实时连续对话一样，不要一次问太多问题，保持自然的对话节奏
- 记得随时查看用户的帖子是否更新
- 你的目标是通过聊天让用户感觉你就像个真正读过他朋友圈的角色，而不是一个机械地调用工具的机器人
- 用户消息前的时间戳为系统自动添加，是可能需要参考的信息，可以结合当前时间考虑做出怎样的回应
- 回复用中文，语气自然轻松`;

    const TOOLS = [
        {
            type: 'function',
            function: {
                name: 'get_current_time',
                description: '获取当前时间',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'list_posts',
                description: '列出用户所有朋友圈帖子的摘要（id、发布者、时间、内容摘要、评论数、点赞数），了解用户发过什么内容',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_post',
                description: '读取某条帖子的完整内容，包括文字、评论、点赞、代写原始输入等',
                parameters: {
                    type: 'object',
                    properties: { id: { type: 'string', description: '帖子的唯一 ID' } },
                    required: ['id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_post_by_date',
                description: '获取指定日期所有帖子的完整内容，日期格式为 YYYY-MM-DD',
                parameters: {
                    type: 'object',
                    properties: { date: { type: 'string', description: '日期，格式 YYYY-MM-DD，例如 2026-05-20' } },
                    required: ['date']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_post_by_keyword',
                description: '搜索包含指定关键词的帖子，返回匹配帖子的完整内容',
                parameters: {
                    type: 'object',
                    properties: { keyword: { type: 'string', description: '搜索关键词' } },
                    required: ['keyword']
                }
            }
        }
    ];

    const NS = window.App.NS;
    const KEY_CHAT_CONV = NS + 'chat_conversations';
    const KEY_ACTIVE_CONV = NS + 'chat_active_conv';
    const KEY_PERSONA = NS + 'chat_persona_text';

    // ========== State ==========
    let conversations = [];
    let activeConvId = null;
    let chatPersonaText = localStorage.getItem(KEY_PERSONA) || '';
    let isGenerating = false;
    let abortController = null;
    let _pendingSync = false;

    // ========== Helpers ==========
    function genId(prefix) { return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }
    function getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
    function setJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
    function formatTimestampAI(ts) {
        var d = new Date(ts);
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function showToast(msg, duration) {
        const el = $('#chatToast'); if (!el) return;
        el.textContent = msg; el.style.display = 'block';
        el.classList.remove('chat-toast-out');
        el.classList.add('chat-toast-in');
        clearTimeout(el._timeout);
        el._timeout = setTimeout(function () {
            el.classList.add('chat-toast-out');
            setTimeout(function () { el.style.display = 'none'; }, 300);
        }, duration || 2000);
    }

    // ========== Tool Implementations ==========
    function tool_get_current_time() {
        return new Date().toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            weekday: 'long', timeZoneName: 'short'
        });
    }

    function tool_list_posts() {
        const posts = window.App.posts || [];
        if (!posts.length) return '你还没有发过朋友圈动态。';
        const summaries = posts.map(function (p) {
            const author = window.App.getAcc(p.userId);
            const nickname = author ? author.nickname : '未知用户';
            const isAI = author && author.isAI ? ' [AI账号-虚拟角色]' : '';
            return {
                id: p.id,
                发布者: nickname + isAI,
                时间: formatTimestampAI(p.timestamp),
                内容摘要: window.App.stripMarkdown(p.text || '').slice(0, 80) + (p.text && p.text.length > 80 ? '...' : ''),
                评论数: (p.comments || []).length,
                点赞数: (p.likes || []).length
            };
        });
        return JSON.stringify(summaries, null, 2);
    }

    function formatPostFull(p) {
        const author = window.App.getAcc(p.userId);
        const nickname = author ? author.nickname : '未知用户';
        const isAI = author && author.isAI ? ' [AI账号-虚拟角色，非真实经历]' : '';
        const result = {
            id: p.id,
            发布者: nickname + isAI,
            时间: formatTimestampAI(p.timestamp),
            正文: p.text || '(无文字内容)'
        };
        if (p.ghostWriter) {
            const ghostAcc = window.App.getAcc(p.ghostWriter);
            result.代写 = (ghostAcc ? ghostAcc.nickname : 'AI') + ' 代笔润色';
            if (p.ghostInput) result['原始输入'] = p.ghostInput;
        }
        if ((p.comments || []).length) {
            result.评论 = p.comments.map(function (c) {
                const ca = window.App.getAcc(c.userId);
                return {
                    评论者: ca ? ca.nickname : '未知',
                    内容: c.text,
                    时间: formatTimestampAI(c.timestamp)
                };
            });
        }
        if ((p.likes || []).length) {
            result.点赞数 = p.likes.length;
            result.点赞者 = p.likes.map(function (lid) {
                const la = window.App.getAcc(lid);
                return la ? la.nickname : '未知';
            });
        }
        if (p.images && p.images.length) result.图片数 = p.images.length;
        if (p.videos && p.videos.length) result.视频数 = p.videos.length;
        return JSON.stringify(result, null, 2);
    }

    function tool_get_post(args) {
        const post = (window.App.posts || []).find(function (p) { return p.id === args.id; });
        if (!post) return '未找到 ID 为 ' + args.id + ' 的帖子，可能已被删除。';
        return formatPostFull(post);
    }

    function tool_get_post_by_date(args) {
        const dateStr = args.date;
        const start = new Date(dateStr + 'T00:00:00+08:00').getTime();
        const end = new Date(dateStr + 'T23:59:59+08:00').getTime();
        if (isNaN(start) || isNaN(end)) return '日期格式无效，请使用 YYYY-MM-DD 格式，例如 2026-05-20。';
        const posts = (window.App.posts || []).filter(function (p) {
            return p.timestamp >= start && p.timestamp <= end;
        });
        if (!posts.length) return dateStr + ' 没有发过朋友圈动态。';
        return posts.length + ' 条动态：\n\n' + posts.map(function (p) { return formatPostFull(p); }).join('\n\n---\n\n');
    }

    function tool_get_post_by_keyword(args) {
        const keyword = (args.keyword || '').toLowerCase();
        if (!keyword) return '请提供搜索关键词。';
        const posts = (window.App.posts || []).filter(function (p) {
            const text = (p.text || '').toLowerCase();
            if (text.indexOf(keyword) !== -1) return true;
            if (p.ghostInput && p.ghostInput.toLowerCase().indexOf(keyword) !== -1) return true;
            return (p.comments || []).some(function (c) { return (c.text || '').toLowerCase().indexOf(keyword) !== -1; });
        });
        if (!posts.length) return '没有找到包含"' + args.keyword + '"的帖子。';
        return '找到 ' + posts.length + ' 条包含"' + args.keyword + '"的动态：\n\n' + posts.map(function (p) { return formatPostFull(p); }).join('\n\n---\n\n');
    }

    const toolExecutors = {
        'get_current_time': { fn: tool_get_current_time, label: '获取当前时间' },
        'list_posts': { fn: tool_list_posts, label: '浏览朋友圈动态列表' },
        'get_post': { fn: tool_get_post, label: '读取帖子详情' },
        'get_post_by_date': { fn: tool_get_post_by_date, label: '按日期搜索帖子' },
        'get_post_by_keyword': { fn: tool_get_post_by_keyword, label: '按关键词搜索帖子' }
    };

    // ========== Data Operations ==========
    function loadConversations() {
        conversations = getJSON(KEY_CHAT_CONV) || [];
        activeConvId = localStorage.getItem(KEY_ACTIVE_CONV) || null;
        if (activeConvId && !conversations.find(function (c) { return c.id === activeConvId; })) {
            activeConvId = conversations.length ? conversations[0].id : null;
        }
        if (!activeConvId && conversations.length) activeConvId = conversations[0].id;
    }

    function loadAppData() {
        var lsAccounts = window.App.getJSON(window.App.KEY_ACC) || [];
        var lsPosts = window.App.getJSON(window.App.KEY_POSTS) || [];
        if (!window.App.accounts || !window.App.accounts.length) {
            window.App.accounts = lsAccounts;
        }
        if (!window.App.posts || !window.App.posts.length) {
            window.App.posts = lsPosts;
        }
    }

    function saveConversations() {
        setJSON(KEY_CHAT_CONV, conversations);
        localStorage.setItem(KEY_ACTIVE_CONV, activeConvId || '');
        syncChatToCloud();
    }

    function syncChatToCloud() {
        if (window._fbChatSync) {
            try {
                window._fbChatSync(conversations);
            } catch (e) {}
            return;
        }
        _pendingSync = true;
    }

    function flushCloudSync() {
        if (!_pendingSync) return;
        if (!window._fbChatSync) return;
        _pendingSync = false;
        try {
            window._fbChatSync(conversations);
        } catch (e) {}
    }

    function getActiveConv() {
        return conversations.find(function (c) { return c.id === activeConvId; }) || null;
    }

    function getMsgById(conv, msgId) {
        if (!conv || !msgId) return null;
        return conv.messages.find(function (m) { return m.id === msgId; }) || null;
    }

    function getChildren(conv, parentId) {
        return (conv.messages || []).filter(function (m) { return m.parentId === parentId; });
    }

    function getSiblings(conv, msgId) {
        const msg = getMsgById(conv, msgId);
        if (!msg) return [];
        return getChildren(conv, msg.parentId);
    }

    function getSiblingIndex(conv, msgId) {
        const siblings = getSiblings(conv, msgId);
        return siblings.findIndex(function (s) { return s.id === msgId; });
    }

    function getCurrentPath(conv) {
        if (!conv || !conv.activeLeafId) return [];
        const path = [];
        let current = getMsgById(conv, conv.activeLeafId);
        while (current) {
            path.unshift(current);
            current = getMsgById(conv, current.parentId);
        }
        return path;
    }

    function createMessage(parentId, role, content, extra) {
        return Object.assign({
            id: genId('msg'),
            parentId: parentId || null,
            role: role,
            content: content,
            timestamp: Date.now()
        }, extra || {});
    }

    function addMessage(conv, msg) {
        conv.messages.push(msg);
        conv.activeLeafId = msg.id;
        conv.updatedAt = Date.now();
        if (!conv.title || conv.title === '新对话') {
            const firstUserMsg = conv.messages.find(function (m) { return m.role === 'user'; });
            if (firstUserMsg) conv.title = firstUserMsg.content.slice(0, 30);
        }
    }

    function createConversation() {
        var conv = {
            id: genId('conv'),
            title: '新对话',
            personaText: chatPersonaText,
            personaPresetId: window.App.activePresetId || null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            activeLeafId: null
        };
        conversations.unshift(conv);
        activeConvId = conv.id;
        saveConversations();
        return conv;
    }

    function deleteConversation(id) {
        const idx = conversations.findIndex(function (c) { return c.id === id; });
        if (idx === -1) return;
        conversations.splice(idx, 1);
        if (activeConvId === id) {
            activeConvId = conversations.length ? conversations[0].id : null;
        }
        saveConversations();
    }

    // ========== Branch Navigation ==========
    function navigateBranch(conv, msgId, direction) {
        const siblings = getSiblings(conv, msgId);
        if (siblings.length <= 1) return;
        let idx = siblings.findIndex(function (s) { return s.id === msgId; });
        if (idx === -1) return;
        idx = direction === 'next' ? (idx + 1) % siblings.length : (idx - 1 + siblings.length) % siblings.length;
        const newMsg = siblings[idx];
        conv.activeLeafId = findLeafForBranch(conv, newMsg.id);
        conv.updatedAt = Date.now();
        saveConversations();
        renderMessages();
    }

    function findLeafForBranch(conv, msgId) {
        let current = msgId;
        while (true) {
            const children = getChildren(conv, current);
            const activeChild = children.find(function (c) { return c._activeInBranch !== false; });
            if (activeChild) { current = activeChild.id; continue; }
            if (children.length === 0) break;
            if (children.length === 1) { current = children[0].id; continue; }
            current = children[0].id;
        }
        return current;
    }

    function rebuildActiveFlags(conv) {
        conv.messages.forEach(function (m) { m._activeInBranch = undefined; });
        let current = getMsgById(conv, conv.activeLeafId);
        while (current) {
            current._activeInBranch = true;
            current = getMsgById(conv, current.parentId);
        }
    }

    // ========== System Prompt Assembly ==========
    function buildSystemPrompt() {
        const conv = getActiveConv();
        const persona = (conv && conv.personaText ? conv.personaText : chatPersonaText).trim();
        let prompt = SYSTEM_PROMPT_BASE;
        if (persona) {
            prompt += '\n\n== 额外人设 ==\n' + persona;
        }
        return prompt;
    }

    // ========== API Calls ==========
    function ensureAIConfig() {
        if (!window.App.aiConfig || !window.App.aiConfig.endpoint || !window.App.aiConfig.model) {
            showToast('⚠️ 请先在主页面配置 AI API Key', 3000);
            return false;
        }
        if (!window.App.aiConfig.apiKey) {
            showToast('⚠️ 请先在主页面配置 AI API Key', 3000);
            return false;
        }
        return true;
    }

    async function callChatAPI(messages, onToolCalls, onStream) {
        if (!ensureAIConfig()) return null;
        const config = window.App.aiConfig;
        const base = config.endpoint.replace(/\/+$/, '');
        const isVolcengine = /volces\.com/i.test(config.endpoint);
        const url = base + (isVolcengine ? '/responses' : '/chat/completions');
        const controller = new AbortController();
        abortController = controller;
        const timeout = (config.timeout || 30) * 1000;
        const timeoutId = setTimeout(function () { controller.abort(); }, timeout);

        try {
            let body;
            if (isVolcengine) {
                body = {
                    model: config.model,
                    input: messages.map(function (m) { return { role: m.role, content: m.content }; }),
                    tools: TOOLS,
                    tool_choice: 'auto',
                    stream: true,
                    thinking: { type: config.thinking ? 'enabled' : 'disabled' }
                };
            } else {
                body = {
                    model: config.model,
                    messages: messages,
                    tools: TOOLS,
                    tool_choice: 'auto',
                    max_tokens: 100000,
                    temperature: 0.7,
                    stream: true
                };
                if (!config.thinking && config.model && config.model.indexOf('deepseek-v4') !== -1) {
                    body.thinking = { type: 'disabled' };
                }
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (config.apiKey || 'no-key') },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                let errMsg = 'API ' + res.status;
                try { var errData = await res.json(); errMsg = errData && errData.error && errData.error.message ? errData.error.message : errMsg; } catch (e) {}
                throw new Error(errMsg);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let accumulatedContent = '';
            let accumulatedReasoning = '';
            let toolCalls = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (var i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line === 'data: [DONE]') continue;
                    if (line.indexOf('data: ') !== 0) continue;
                    var jsonStr = line.slice(6);
                    try {
                        var chunk = JSON.parse(jsonStr);
                        var delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) || {};
                        if (delta.reasoning_content) {
                            accumulatedReasoning += delta.reasoning_content;
                            if (onStream) onStream({ type: 'reasoning', content: delta.reasoning_content });
                        }
                        if (delta.content) {
                            accumulatedContent += delta.content;
                            if (onStream) onStream({ type: 'content', content: delta.content });
                        }
                        if (delta.tool_calls) {
                            for (var j = 0; j < delta.tool_calls.length; j++) {
                                var tc = delta.tool_calls[j];
                                var idx = tc.index || 0;
                                while (toolCalls.length <= idx) toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
                                if (tc.id) toolCalls[idx].id = tc.id;
                                if (tc.function) {
                                    if (tc.function.name) toolCalls[idx].function.name += tc.function.name;
                                    if (tc.function.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                                }
                            }
                        }
                    } catch (e) {}
                }
            }

            if (toolCalls.length) {
                toolCalls = toolCalls.filter(function (tc) { return tc.id && tc.function.name; });
                toolCalls = toolCalls.map(function (tc) {
                    return { id: tc.id, function: { name: tc.function.name, arguments: tc.function.arguments } };
                });
                if (onToolCalls) onToolCalls(toolCalls);
                return { type: 'tool_calls', toolCalls: toolCalls, reasoningContent: accumulatedReasoning || null };
            }
            return { type: 'text', content: accumulatedContent.trim(), reasoningContent: accumulatedReasoning || null };
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') throw new Error('请求超时，请重试');
            throw e;
        }
    }

    async function executeToolCall(toolCall) {
        const fnName = toolCall.function.name;
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch (e) {}
        const executor = toolExecutors[fnName];
        if (!executor) return { toolCallId: toolCall.id, name: fnName, result: '未知工具: ' + fnName, error: true };
        try {
            const result = executor.fn(args);
            return { toolCallId: toolCall.id, name: fnName, result: typeof result === 'string' ? result : JSON.stringify(result, null, 2), label: executor.label };
        } catch (e) {
            return { toolCallId: toolCall.id, name: fnName, result: '工具执行错误: ' + e.message, error: true, label: executor.label };
        }
    }

    async function generateAIReply(conv) {
        if (isGenerating) return;
        if (!ensureAIConfig()) return;
        isGenerating = true;
        updateSendUI();

        const systemPrompt = buildSystemPrompt();
        const currentPath = getCurrentPath(conv);
        const messages = [{ role: 'system', content: systemPrompt }];

        for (var i = 0; i < currentPath.length; i++) {
            var m = currentPath[i];
            if (m.role === 'user') {
                var ts = m.timestamp ? formatTimestampAI(m.timestamp) : '';
                var userContent = ts ? '[' + ts + '] ' + m.content : m.content;
                messages.push({ role: 'user', content: userContent });
            } else if (m.role === 'assistant') {
                var am = { role: 'assistant', content: m.content || null };
                if (m.reasoningContent) am.reasoning_content = m.reasoningContent;
                if (m.toolCalls && m.toolCalls.length) {
                    am.tool_calls = m.toolCalls.map(function (tc) {
                        return { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args || '{}' } };
                    });
                }
                messages.push(am);
            } else if (m.role === 'tool') {
                messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
            }
        }

        const allToolResults = [];
        let loopCount = 0;
        const MAX_LOOPS = 10;
        let finalContent = '';
        let finalReasoning = null;

        var liveThinkingEl = null;
        var liveContent = '';
        var liveReasoning = '';

        showGeneratingHint(true);

        try {
            while (loopCount < MAX_LOOPS) {
                loopCount++;
                if (liveThinkingEl) removeLiveThinking(liveThinkingEl);
                liveThinkingEl = createLiveThinking();
                liveContent = '';
                liveReasoning = '';
                const result = await callChatAPI(messages, function (toolCalls) {
                    for (var k = 0; k < toolCalls.length; k++) {
                        showToolCallIndicator(toolCalls[k]);
                    }
                }, function (stream) {
                    if (stream.type === 'reasoning') {
                        liveReasoning += stream.content;
                        updateLiveThinking(liveThinkingEl, liveReasoning, liveContent);
                    } else if (stream.type === 'content') {
                        liveContent += stream.content;
                        updateLiveThinking(liveThinkingEl, liveReasoning, liveContent);
                    }
                });

                if (!result) {
                    throw new Error('AI 响应为空');
                }

                if (result.type === 'text') {
                    finalContent = result.content;
                    finalReasoning = result.reasoningContent || null;
                    break;
                }

                if (result.type === 'tool_calls') {
                    const assistantMsg = createMessage(conv.activeLeafId, 'assistant', '', {
                        toolCalls: result.toolCalls.map(function (tc) { return { id: tc.id, name: tc.function.name, args: tc.function.arguments }; }),
                        toolResults: [],
                        reasoningContent: result.reasoningContent || null
                    });
                    addMessage(conv, assistantMsg);

                    for (var j = 0; j < result.toolCalls.length; j++) {
                        const tc = result.toolCalls[j];
                        const toolResult = await executeToolCall(tc);
                        allToolResults.push(toolResult);
                        assistantMsg.toolResults.push(toolResult);

                        const toolMsg = createMessage(conv.activeLeafId, 'tool', toolResult.result, {
                            toolCallId: tc.id,
                            toolName: toolResult.name,
                            toolLabel: toolResult.label
                        });
                        addMessage(conv, toolMsg);
                    }

                    for (var ti = 0; ti < result.toolCalls.length; ti++) {
                        const tc = result.toolCalls[ti];
                        const tcr = allToolResults[allToolResults.length - result.toolCalls.length + ti];
                        var asm = { role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }] };
                        if (result.reasoningContent) asm.reasoning_content = result.reasoningContent;
                        messages.push(asm);
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: tcr.result });
                    }

                    saveConversations();
                    renderMessages();
                    continue;
                }
            }

            if (!finalContent && loopCount >= MAX_LOOPS) {
                finalContent = '抱歉，工具调用次数过多，请尝试换一种方式提问。';
            }

            if (finalContent) {
                const replyMsg = createMessage(conv.activeLeafId, 'assistant', finalContent, {
                    reasoningContent: finalReasoning || null
                });
                addMessage(conv, replyMsg);
            }
        } catch (e) {
            const errMsg = createMessage(conv.activeLeafId, 'assistant', '❌ ' + (e.message || '未知错误'));
            addMessage(conv, errMsg);
            showToast('❌ ' + (e.message || '请求失败'), 3000);
        } finally {
            isGenerating = false;
            abortController = null;
            removeLiveThinking(liveThinkingEl);
            saveConversations();
            renderMessages();
            updateSendUI();
            showGeneratingHint(false);
            hideToolCallIndicator();
        }
    }

    function stopGenerating() {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        isGenerating = false;
        var liveEl = document.querySelector('.chat-live-thinking');
        if (liveEl) removeLiveThinking(liveEl);
        updateSendUI();
        showGeneratingHint(false);
        hideToolCallIndicator();
    }

    // ========== UI Rendering ==========
    function renderConversationList() {
        const list = $('#chatConvList');
        if (!list) return;
        const sorted = conversations.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });

        if (!sorted.length) {
            list.innerHTML = '<div class="chat-conv-empty">暂无对话，点击 ＋ 开始</div>';
            return;
        }

        list.innerHTML = sorted.map(function (conv) {
            const isActive = conv.id === activeConvId;
            const title = window.App.escapeHtml(conv.title || '新对话');
            const time = window.App.formatTime(conv.updatedAt);
            return '<div class="chat-conv-item' + (isActive ? ' active' : '') + '" data-conv-id="' + conv.id + '">' +
                '<div class="chat-conv-item-title">' + title + '</div>' +
                '<div class="chat-conv-item-meta">' +
                '<span class="chat-conv-item-time">' + time + '</span>' +
                '<button class="chat-conv-item-del" data-action="del-conv" data-conv-id="' + conv.id + '" title="删除对话">×</button>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    function renderMessages() {
        const container = $('#chatMessages');
        const welcome = $('#chatWelcome');
        if (!container) return;

        const conv = getActiveConv();
        if (!conv) {
            container.innerHTML = '';
            if (welcome) welcome.style.display = 'flex';
            updateHeaderTitle();
            return;
        }

        if (welcome) welcome.style.display = 'none';
        rebuildActiveFlags(conv);
        const path = getCurrentPath(conv);

        var html = '';
        var accumulatedThinking = '';
        for (var i = 0; i < path.length; i++) {
            var msg = path[i];
            if (msg.role === 'tool') continue;

            if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length) {
                accumulatedThinking += buildThinkingStep(msg);
                html += renderBranchNav(conv, msg.id, 'assistant');
                continue;
            }
            if (msg.role === 'user') {
                html += renderUserMessage(msg, conv, i, path.length);
                accumulatedThinking = '';
                html += renderBranchNav(conv, msg.id, 'user');
            } else if (msg.role === 'assistant') {
                html += renderAssistantMessage(msg, conv, i, path.length, accumulatedThinking);
                accumulatedThinking = '';
                html += renderBranchNav(conv, msg.id, 'assistant');
            }
        }

        if (isGenerating) {
            html += renderTypingIndicator();
        }

        container.innerHTML = html;
        updateHeaderTitle();
        scrollToBottom();
    }

    function buildThinkingStep(assistantMsg) {
        var html = '';
        if (assistantMsg.reasoningContent) {
            html += '<div class="chat-thinking-step-reason">' + window.App.escapeHtml(assistantMsg.reasoningContent) + '</div>';
        }
        var results = assistantMsg.toolResults || [];
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            html += '<div class="chat-thinking-step-tool">';
            html += '<span class="chat-thinking-tool-name">🔧 ' + (r.label || r.name) + '</span>';
            html += '<pre class="chat-tool-result-content">' + window.App.escapeHtml((r.result || '').slice(0, 2000)) + '</pre>';
            html += '</div>';
        }
        return html;
    }

    function renderToolCallGroup(assistantMsg, path) {
        return '';
    }

    function renderUserMessage(msg, conv, index, total) {
        var html = '<div class="chat-message chat-message-user" data-msg-id="' + msg.id + '">';
        html += '<div class="chat-message-bubble chat-bubble-user">';
        html += '<div class="chat-bubble-content">' + window.App.escapeHtml(msg.content) + '</div>';
        html += '</div>';
        html += '<div class="chat-message-time">' + window.App.formatTime(msg.timestamp) + '</div>';
        html += '<div class="chat-message-actions">';
        html += '<button class="chat-msg-action-btn" data-action="edit-msg" data-msg-id="' + msg.id + '" title="编辑">✏️</button>';
        html += '<button class="chat-msg-action-btn" data-action="copy-msg" data-msg-id="' + msg.id + '" title="复制">📋</button>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderAssistantMessage(msg, conv, index, total, mergedThinking) {
        var content = (msg.content || '').trim();
        var renderedContent;
        try {
            renderedContent = window.App.parseMarkdownAI ? window.App.parseMarkdownAI(content) : window.App.parseMarkdown(content);
        } catch (e) {
            renderedContent = window.App.escapeHtml(content);
        }

        var thinkingHtml = mergedThinking || '';
        if (msg.reasoningContent) {
            thinkingHtml += '<div class="chat-thinking-step-reason">' + window.App.escapeHtml(msg.reasoningContent) + '</div>';
        }

        var html = '<div class="chat-message chat-message-assistant" data-msg-id="' + msg.id + '">';
        if (thinkingHtml) {
            html += '<div class="chat-thinking-block">';
            html += '<div class="chat-thinking-toggle" onclick="var p=this.nextElementSibling;var a=this.querySelector(\'.chat-thinking-arrow\');p.style.display=p.style.display===\'none\'?\'block\':\'none\';a.textContent=a.textContent===\'▾\'?\'▸\':\'▾\';">';
            html += '<span class="chat-thinking-label">💭 思考过程</span>';
            html += '<span class="chat-thinking-arrow">▸</span>';
            html += '</div>';
            html += '<div class="chat-thinking-content" style="display:none;">' + thinkingHtml + '</div>';
            html += '</div>';
        }
        html += '<div class="chat-message-bubble chat-bubble-assistant">';
        html += '<div class="chat-bubble-content chat-markdown-body">' + renderedContent + '</div>';
        html += '</div>';
        html += '<div class="chat-message-time">' + window.App.formatTime(msg.timestamp) + '</div>';
        html += '<div class="chat-message-actions">';
        html += '<button class="chat-msg-action-btn" data-action="retry-msg" data-msg-id="' + msg.id + '" title="重试">🔄</button>';
        html += '<button class="chat-msg-action-btn" data-action="copy-msg" data-msg-id="' + msg.id + '" title="复制">📋</button>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderBranchNav(conv, msgId, role) {
        var siblings = getSiblings(conv, msgId);
        if (siblings.length <= 1) return '';
        var idx = getSiblingIndex(conv, msgId);
        if (idx === -1) return '';
        var alignClass = role === 'user' ? 'chat-branch-nav-user' : 'chat-branch-nav-assistant';
        var html = '<div class="chat-branch-nav ' + alignClass + '" data-msg-id="' + msgId + '">';
        html += '<button class="chat-branch-btn" data-action="branch-prev" data-msg-id="' + msgId + '" ' + (idx === 0 ? 'disabled' : '') + '>◄</button>';
        html += '<span class="chat-branch-label">分支 ' + (idx + 1) + '/' + siblings.length + '</span>';
        html += '<button class="chat-branch-btn" data-action="branch-next" data-msg-id="' + msgId + '" ' + (idx === siblings.length - 1 ? 'disabled' : '') + '>►</button>';
        html += '</div>';
        return html;
    }

    function renderTypingIndicator() {
        return '<div class="chat-message chat-message-assistant chat-message-typing">' +
            '<div class="chat-message-bubble chat-bubble-assistant">' +
            '<div class="chat-typing-indicator">' +
            '<span class="chat-typing-dot"></span>' +
            '<span class="chat-typing-dot"></span>' +
            '<span class="chat-typing-dot"></span>' +
            '</div></div></div>';
    }

    function createLiveThinking() {
        var el = document.createElement('div');
        el.className = 'chat-message chat-message-assistant chat-live-thinking';
        el.innerHTML = '<div class="chat-thinking-block">' +
            '<div class="chat-thinking-toggle" onclick="var p=this.nextElementSibling;var a=this.querySelector(\'.chat-thinking-arrow\');p.style.display=p.style.display===\'none\'?\'block\':\'none\';a.textContent=a.textContent===\'▾\'?\'▸\':\'▾\';">' +
            '<span class="chat-thinking-label">💭 思考中</span>' +
            '<span class="chat-thinking-dots"></span>' +
            '<span class="chat-thinking-arrow">▸</span>' +
            '</div>' +
            '<div class="chat-thinking-content chat-live-thinking-content" style="display:none;"></div>' +
            '</div>' +
            '<div class="chat-message-bubble chat-bubble-assistant chat-live-text-bubble" style="display:none;">' +
            '<div class="chat-bubble-content chat-live-text-content"></div>' +
            '</div>';
        var container = $('#chatMessages');
        if (container) container.appendChild(el);
        return el;
    }

    function updateLiveThinking(el, reasoning, content) {
        var reasoningEl = el.querySelector('.chat-live-thinking-content');
        if (reasoningEl && reasoning) {
            reasoningEl.innerHTML = '<div class="chat-thinking-step-reason">' + window.App.escapeHtml(reasoning) + '</div>';
            reasoningEl.style.display = 'block';
            var toggle = el.querySelector('.chat-thinking-toggle');
            var arrow = toggle ? toggle.querySelector('.chat-thinking-arrow') : null;
            if (arrow && reasoningEl.style.display !== 'none') {
                arrow.textContent = '▾';
            }
        }
        var textEl = el.querySelector('.chat-live-text-content');
        var bubble = el.querySelector('.chat-live-text-bubble');
        if (textEl && bubble && content) {
            bubble.style.display = 'block';
            try {
                textEl.innerHTML = window.App.parseMarkdownAI ? window.App.parseMarkdownAI(content) : window.App.parseMarkdown(content);
            } catch (e) {
                textEl.textContent = content;
            }
        }
        scrollToBottom();
    }

    function removeLiveThinking(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function renderPersonaPreview() {
        const el = $('#chatPersonaPreview');
        if (!el) return;
        var text = buildSystemPrompt();
        el.textContent = text;
    }

    function updateHeaderTitle() {
        const el = $('#chatHeaderTitle');
        if (!el) return;
        const conv = getActiveConv();
        el.textContent = conv ? (conv.title || 'AI 聊天') : 'AI 聊天';
    }

    function scrollToBottom() {
        const container = $('#chatMessages');
        if (!container) return;
        requestAnimationFrame(function () {
            container.scrollTop = container.scrollHeight;
        });
    }

    function showGeneratingHint(show) {
        const el = $('#chatGeneratingHint');
        if (el) el.style.display = show ? 'inline' : 'none';
    }

    function updateSendUI() {
        const sendBtn = $('#chatSendBtn');
        const input = $('#chatInput');
        if (sendBtn) {
            if (isGenerating) {
                sendBtn.textContent = '■';
                sendBtn.title = '停止';
                sendBtn.disabled = false;
                sendBtn.classList.add('chat-send-stop');
            } else {
                sendBtn.textContent = '➤';
                sendBtn.title = '发送';
                sendBtn.classList.remove('chat-send-stop');
                if (input) sendBtn.disabled = !input.value.trim();
            }
        }
    }

    function showToolCallIndicator(toolCall) {
        const toggle = document.querySelector('.chat-tool-toggle-text');
        if (toggle) {
            const executor = toolExecutors[toolCall.function.name];
            toggle.textContent = '正在' + (executor ? executor.label : '执行工具') + '...';
        }
    }

    function hideToolCallIndicator() {
        const toggle = document.querySelector('.chat-tool-toggle-text');
        if (toggle) toggle.textContent = '查阅完成';
    }

    // ========== Event Handlers ==========
    function handleSend() {
        if (isGenerating) { stopGenerating(); return; }
        const input = $('#chatInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;

        let conv = getActiveConv();
        if (!conv) conv = createConversation();
        if (!conv) return;

        input.value = '';
        updateCharCount();
        updateSendUI();

        const userMsg = createMessage(conv.activeLeafId, 'user', text);
        addMessage(conv, userMsg);
        saveConversations();
        renderMessages();
        renderConversationList();

        generateAIReply(conv);
    }

    function handleEdit(msgId) {
        const conv = getActiveConv();
        if (!conv) return;
        const msg = getMsgById(conv, msgId);
        if (!msg || msg.role !== 'user') return;

        const newText = prompt('编辑消息：', msg.content);
        if (newText === null || newText.trim() === '') return;
        if (newText.trim() === msg.content) return;

        const newMsg = createMessage(msg.parentId, 'user', newText.trim());
        addMessage(conv, newMsg);
        saveConversations();
        renderMessages();

        generateAIReply(conv);
    }

    function handleRetry(msgId) {
        if (isGenerating) return;
        const conv = getActiveConv();
        if (!conv) return;
        const msg = getMsgById(conv, msgId);
        if (!msg || msg.role !== 'assistant') return;

        var userMsgId = msg.parentId;
        while (userMsgId) {
            var parentMsg = getMsgById(conv, userMsgId);
            if (!parentMsg) return;
            if (parentMsg.role === 'user') break;
            userMsgId = parentMsg.parentId;
        }
        if (!userMsgId) return;

        conv.activeLeafId = userMsgId;
        conv.updatedAt = Date.now();
        saveConversations();
        renderMessages();

        generateAIReply(conv);
    }

    function handleCopy(msgId) {
        const conv = getActiveConv();
        if (!conv) return;
        const msg = getMsgById(conv, msgId);
        if (!msg || !msg.content) return;
        try {
            navigator.clipboard.writeText(msg.content).then(function () {
                showToast('已复制');
            }).catch(function () {
                showToast('复制失败');
            });
        } catch (e) {
            showToast('复制失败');
        }
    }

    function handleBranchNav(msgId, direction) {
        if (isGenerating) return;
        const conv = getActiveConv();
        if (!conv) return;
        navigateBranch(conv, msgId, direction);
    }

    function handleSwitchConversation(id) {
        if (isGenerating) return;
        activeConvId = id;
        localStorage.setItem(KEY_ACTIVE_CONV, activeConvId);
        var conv = getActiveConv();
        chatPersonaText = (conv && conv.personaText != null) ? conv.personaText : (localStorage.getItem(KEY_PERSONA) || '');
        renderConversationList();
        renderMessages();
    }

    function handleDeleteConversation(id) {
        if (!confirm('确定删除这个对话？')) return;
        deleteConversation(id);
        renderConversationList();
        renderMessages();
    }

    function handleNewConversation() {
        if (isGenerating) return;
        createConversation();
        renderConversationList();
        renderMessages();
        const input = $('#chatInput');
        if (input) input.focus();
    }

    function handleSavePersona() {
        var textarea = $('#chatPersonaTextarea');
        if (!textarea) return;
        chatPersonaText = textarea.value.trim();
        localStorage.setItem(KEY_PERSONA, chatPersonaText);
        updateCurrentConvPersona();
        renderPersonaPreview();
        showToast('人设已保存到当前对话');
        closePersonaPanel();
    }

    function updateCurrentConvPersona() {
        var conv = getActiveConv();
        if (conv) {
            conv.personaText = chatPersonaText;
            saveConversations();
        }
    }

    function togglePersonaPanel() {
        const panel = $('#chatPersonaPanel');
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        if (isOpen) {
            closePersonaPanel();
        } else {
            openPersonaPanel();
        }
    }

    function openPersonaPanel() {
        const panel = $('#chatPersonaPanel');
        if (!panel) return;
        panel.style.display = 'flex';
        const textarea = $('#chatPersonaTextarea');
        if (textarea) textarea.value = chatPersonaText;
        renderPresetSelect();
        renderPersonaPreview();
    }

    function closePersonaPanel() {
        const panel = $('#chatPersonaPanel');
        if (panel) panel.style.display = 'none';
    }

    function renderPresetSelect() {
        const select = $('#chatPresetSelect');
        if (!select) return;
        const presets = window.App.aiPresets || [];
        select.innerHTML = presets.map(function (p) {
            var selected = (p.id === window.App.activePresetId) ? ' selected' : '';
            return '<option value="' + p.id + '"' + selected + '>' + window.App.escapeHtml(p.name) + ' (' + window.App.escapeHtml(p.model || '') + ')</option>';
        }).join('');
    }

    function updateCharCount() {
        const input = $('#chatInput');
        const counter = $('#chatCharCount');
        if (!input || !counter) return;
        counter.textContent = input.value.length + '/20000';
    }

    function autoResizeInput() {
        const input = $('#chatInput');
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    }

    // ========== Load Cloud Data ==========
    async function loadAppDataFromCloud() {
        try {
            if (!window.App._fbReadyPromise) return;
            await Promise.race([
                window.App._fbReadyPromise,
                new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 3000); })
            ]);
            if (window._fbLoadData) {
                var cloudData = await window._fbLoadData();
                if (cloudData) {
                    if (cloudData.accounts && (Array.isArray(cloudData.accounts) ? cloudData.accounts.length : Object.keys(cloudData.accounts).length)) {
                        window.App.accounts = Array.isArray(cloudData.accounts) ? cloudData.accounts : Object.values(cloudData.accounts);
                    }
                    if (cloudData.posts && (Array.isArray(cloudData.posts) ? cloudData.posts.length : Object.keys(cloudData.posts).length)) {
                        var rawPosts = Array.isArray(cloudData.posts) ? cloudData.posts : Object.values(cloudData.posts);
                        window.App.posts = rawPosts.map(function (p) {
                            if (!p) return p;
                            p.likes = Array.isArray(p.likes) ? p.likes : (p.likes ? Object.values(p.likes) : []);
                            p.comments = Array.isArray(p.comments) ? p.comments : (p.comments ? Object.values(p.comments) : []);
                            p.images = Array.isArray(p.images) ? p.images : (p.images ? Object.values(p.images) : []);
                            p.videos = Array.isArray(p.videos) ? p.videos : (p.videos ? Object.values(p.videos) : []);
                            return p;
                        });
                    }
                }
            }
        } catch (e) {}
    }

    async function loadChatFromCloud() {
        try {
            if (!window.App._fbReadyPromise) return;
            await Promise.race([
                window.App._fbReadyPromise,
                new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 3000); })
            ]);
            flushCloudSync();
            if (window._fbChatLoad) {
                var cloudConvs = await window._fbChatLoad();
                if (cloudConvs && cloudConvs.length) {
                    if (cloudConvs.length > conversations.length ||
                        (cloudConvs.length && cloudConvs[0].updatedAt > (conversations[0] ? conversations[0].updatedAt : 0))) {
                        conversations = cloudConvs;
                        if (activeConvId && !conversations.find(function (c) { return c.id === activeConvId; })) {
                            activeConvId = conversations[0].id;
                        }
                        saveConversations();
                        renderConversationList();
                        renderMessages();
                        showToast('☁️ 对话记录已同步');
                    }
                }
            }
        } catch (e) {}
    }

    // ========== Event Binding ==========
    function bindEvents() {
        var sendBtn = $('#chatSendBtn');
        if (sendBtn) {
            sendBtn.addEventListener('click', handleSend);
        }

        var input = $('#chatInput');
        if (input) {
            input.addEventListener('input', function () {
                updateCharCount();
                autoResizeInput();
                updateSendUI();
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.isComposing) {
                    e.preventDefault();
                    handleSend();
                }
            });
        }

        var newConvBtn = $('#chatNewConvBtn');
        if (newConvBtn) {
            newConvBtn.addEventListener('click', handleNewConversation);
        }

        var convList = $('#chatConvList');
        if (convList) {
            convList.addEventListener('click', function (e) {
                var item = e.target.closest('.chat-conv-item');
                if (!item) return;
                var delBtn = e.target.closest('[data-action="del-conv"]');
                if (delBtn) {
                    e.stopPropagation();
                    handleDeleteConversation(delBtn.dataset.convId);
                    return;
                }
                handleSwitchConversation(item.dataset.convId);
            });
        }

        var messagesArea = $('#chatMessages');
        if (messagesArea) {
            messagesArea.addEventListener('click', function (e) {
                var actionBtn = e.target.closest('[data-action]');
                if (!actionBtn) return;

                var action = actionBtn.dataset.action;
                var msgId = actionBtn.dataset.msgId;

                switch (action) {
                    case 'edit-msg': handleEdit(msgId); break;
                    case 'retry-msg': handleRetry(msgId); break;
                    case 'copy-msg': handleCopy(msgId); break;
                    case 'branch-prev': handleBranchNav(msgId, 'prev'); break;
                    case 'branch-next': handleBranchNav(msgId, 'next'); break;
                }
            });
        }

        var personaBtn = $('#chatPersonaBtn');
        if (personaBtn) {
            personaBtn.addEventListener('click', togglePersonaPanel);
        }

        var personaCloseBtn = $('#chatPersonaCloseBtn');
        if (personaCloseBtn) {
            personaCloseBtn.addEventListener('click', closePersonaPanel);
        }

        var personaSaveBtn = $('#chatPersonaSaveBtn');
        if (personaSaveBtn) {
            personaSaveBtn.addEventListener('click', handleSavePersona);
        }

        var presetSelect = $('#chatPresetSelect');
        if (presetSelect) {
            presetSelect.addEventListener('change', function () {
                window.App.switchAIPreset(this.value, true);
            });
        }

        var personaTextarea = $('#chatPersonaTextarea');
        if (personaTextarea) {
            personaTextarea.addEventListener('input', function () {
                renderPersonaPreview();
            });
        }

        var toggleSidebarBtn = $('#chatToggleSidebarBtn');
        if (toggleSidebarBtn) {
            toggleSidebarBtn.addEventListener('click', function () {
                openSidebar();
            });
        }

        var sidebarCloseBtn = $('#chatSidebarCloseBtn');
        if (sidebarCloseBtn) {
            sidebarCloseBtn.addEventListener('click', function () {
                closeSidebar();
            });
        }

        var sidebarOverlay = $('#chatSidebarOverlay');
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', function () {
                closeSidebar();
            });
        }

        var chatMain = document.querySelector('.chat-main');
        if (chatMain) {
            chatMain.addEventListener('click', function (e) {
                var sidebar = $('#chatSidebar');
                if (sidebar && sidebar.classList.contains('chat-sidebar-open')) {
                    if (!e.target.closest('.chat-sidebar') && !e.target.closest('#chatToggleSidebarBtn')) {
                        closeSidebar();
                    }
                }
            });
        }
    }

    function openSidebar() {
        var sidebar = $('#chatSidebar');
        var overlay = $('#chatSidebarOverlay');
        if (sidebar) sidebar.classList.add('chat-sidebar-open');
        if (overlay) overlay.style.display = 'block';
    }

    function closeSidebar() {
        var sidebar = $('#chatSidebar');
        var overlay = $('#chatSidebarOverlay');
        if (sidebar) sidebar.classList.remove('chat-sidebar-open');
        if (overlay) overlay.style.display = 'none';
    }

    // ========== Init ==========
    function init() {
        loadAppData();
        var backLink = $('#chatBackLink');
        if (backLink) backLink.href = 'index.html?ns=' + encodeURIComponent(window.App.namespaceName || 'default');
        loadConversations();
        var activeConv = conversations.find(function (c) { return c.id === activeConvId; });
        if (activeConv && activeConv.personaText != null) {
            chatPersonaText = activeConv.personaText;
        }
        renderConversationList();
        renderMessages();
        bindEvents();
        updateCharCount();
        updateSendUI();
        loadAppDataFromCloud();
        loadChatFromCloud();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
