// ==UserScript==
// 替换 Bilibili 旧版 iframe 为可用的新格式
// ==/UserScript==

(function () {
    'use strict';

    /**
     * 将 HTML 中的 Bilibili 旧版播放器 iframe 替换为：
     * - 一个跳转链接
     * - 一个移动端兼容的新版 iframe
     *
     * 旧格式示例：
     *   <iframe src="//player.bilibili.com/player.html?isOutside=true&aid=...&bvid=BV...&cid=...&p=1" ...></iframe>
     *
     * 替换后：
     *   <a href="https://www.bilibili.com/video/BV..." target="_blank">前往bilibili</a>
     *   <iframe id="biliPlayer" src="//www.bilibili.com/blackboard/html5mobileplayer.html?..." allowfullscreen="true" width="100%" height="350"></iframe>
     */
    /**
     * 从 bilibili 视频 URL 中提取 bvid
     */
    function extractBvid(url) {
        var m = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
        return m ? m[1] : null;
    }

    /**
     * 构建新版 iframe 的 src
     */
    function buildPlayerSrc(bvid, aid, cid, p) {
        var q = 'isOutside=true' +
            (aid ? '&aid=' + encodeURIComponent(aid) : '') +
            '&bvid=' + encodeURIComponent(bvid) +
            (cid ? '&cid=' + encodeURIComponent(cid) : '') +
            '&p=' + encodeURIComponent(p || '1') +
            '&as_wide=1&high_quality=1' +
            '&allowfullscreen=true';
        return '//www.bilibili.com/blackboard/html5mobileplayer.html?' + q;
    }

    /**
     * 构建替换后的 HTML（标题（可选）+ 链接 + iframe）
     * @param {string} bvid
     * @param {string|null} headingText — 有则渲染为加粗大号文字，无则不输出
     * @param {string} p — 分集参数
     */
    function buildReplacement(bvid, headingText, p) {
        var href = 'https://www.bilibili.com/video/' + encodeURIComponent(bvid);
        var src = buildPlayerSrc(bvid, null, null, p);
        var html = '';
        if (headingText) {
            var esc = headingText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += '<div style="font-size:14pt;font-weight:bold;margin:8px 0 0">' + esc + '</div>\n';
        }
        html += '<div style="text-align:right"><a href="' + href + '" target="_blank" rel="noopener noreferrer">前往bilibili</a></div>\n' +
            '<iframe id="biliPlayer" src="' + src + '" allowfullscreen="true" width="100%" height="350" scrolling="no" frameborder="0"></iframe>';
        return html;
    }

    // ---------- b23.tv 短链解析 ----------

    var b23ResolveCache = {};      // 短码 → bvid
    var B23_PLACEHOLDER_CNT = 0;

    /**
     * 尝试解析 b23.tv 短链，返回完整 URL（follow redirect）
     */
    function resolveB23Url(shortCode) {
        if (b23ResolveCache[shortCode]) {
            return Promise.resolve(b23ResolveCache[shortCode]);
        }
        return fetch('https://b23.tv/' + shortCode, {
            method: 'HEAD',
            redirect: 'follow',
            mode: 'cors'
        }).then(function (resp) {
            var finalUrl = resp.url;
            var bvid = extractBvid(finalUrl);
            if (bvid) {
                b23ResolveCache[shortCode] = bvid;
                return bvid;
            }
            // 重定向后仍没有 bvid
            throw new Error('no bvid');
        }).catch(function () {
            // CORS 或其它失败 — 标记为不可解析
            b23ResolveCache[shortCode] = null;
            return null;
        });
    }

    /**
     * 扫描 DOM 中所有未解析的 b23 占位，逐个 fetch 并替换
     */
    function resolvePendingB23() {
        var els = document.querySelectorAll('.b23-pending');
        if (!els.length) return;
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var code = el.getAttribute('data-code');
            if (!code) continue;
            (function (elem, shortCode) {
                resolveB23Url(shortCode).then(function (bvid) {
                    if (bvid) {
                        elem.outerHTML = buildReplacement(bvid);
                    } else {
                        // 解析失败 → 保留为普通超链接
                        elem.outerHTML = '<a href="https://b23.tv/' + shortCode +
                            '" target="_blank" rel="noopener noreferrer">https://b23.tv/' + shortCode + '</a>';
                    }
                });
            })(el, code);
        }
    }

    // 周期性扫描（低频率，不影响性能）
    setInterval(resolvePendingB23, 3000);

    // 也暴露给外部，方便 renderTimeline 等主动触发
    window.App.resolvePendingB23 = resolvePendingB23;

    /**
     * 保护代码块：提取 fenced code block 和 inline code 为占位符，
     * 避免内部的 bilibili URL 被替换。
     */
    function protectCodeBlocks(text) {
        var blocks = [];
        // fenced: ```...``` 或 ~~~...~~~
        text = text.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, function (m) {
            blocks.push(m);
            return '\u0000CB' + (blocks.length - 1) + '\u0000';
        });
        // inline code: `...`（已保护的 fenced 占位不含 `，不会误伤）
        text = text.replace(/`([^`\n]+)`/g, function (m) {
            blocks.push(m);
            return '\u0000CB' + (blocks.length - 1) + '\u0000';
        });
        return { text: text, blocks: blocks };
    }

    function restoreCodeBlocks(text, blocks) {
        for (var i = 0; i < blocks.length; i++) {
            text = text.split('\u0000CB' + i + '\u0000').join(blocks[i]);
        }
        return text;
    }

    /**
     * 步骤 A：预处理原始文本 — 将 【文案】bilibili_url / b23.tv 替换为 HTML
     * 需在 marked 解析前执行，避免 URL 被 auto-link
     *
     * 代码块内的 URL 会被保护，不被替换。
     * 三个模式合并为一次替换，避免前次替换输出的 HTML 被后次再次匹配。
     */
    function preprocessBilibiliText(text) {
        if (!text || typeof text !== 'string') return text;

        // 先保护代码块
        var ctx = protectCodeBlocks(text);
        text = ctx.text;

        // 一次遍历匹配三种模式，顺序匹配不会互相污染
        // 模式 A: 【文案】 bilibili.com/video/BV...?p=2
        // 模式 B: 裸 bilibili.com/video/BV...?p=2
        // 模式 C: b23.tv/xxx
        text = text.replace(
            /(?:【([\s\S]*)】\s*)?https?:\/\/(?:www\.)?(?:bilibili\.com\/video\/(BV[a-zA-Z0-9]+)|b23\.tv\/([a-zA-Z0-9]+))([^\s<]*)/gi,
            function (match, linkText, bvid, shortCode, queryStr) {
                if (bvid) {
                    // 从原链接提取 p 参数（分集）
                    var p = '1';
                    if (queryStr) {
                        var pm = queryStr.match(/[?&]p=(\d+)/i);
                        if (pm) p = pm[1];
                    }
                    return buildReplacement(bvid, linkText ? linkText.trim() : null, p);
                }
                if (shortCode) {
                    B23_PLACEHOLDER_CNT++;
                    var cached = b23ResolveCache[shortCode];
                    if (cached === null) {
                        return '<a href="https://b23.tv/' + shortCode +
                            '" target="_blank" rel="noopener noreferrer">https://b23.tv/' + shortCode + '</a>';
                    }
                    if (cached) {
                        return buildReplacement(cached);
                    }
                    return '<span class="b23-pending" data-code="' + shortCode + '">⏳ 解析中…</span>';
                }
                return match;
            }
        );

        // 恢复代码块
        text = restoreCodeBlocks(text, ctx.blocks);
        return text;
    }

    /**
     * 步骤 B：后处理 HTML — 将旧版 iframe 替换为新版
     * 跳过 <code> / <pre><code> 内部的 iframe（代码块内的不替换），
     * 也跳过已经是目标格式（含 biliPlayer id）的 iframe。
     */
    function replaceBilibiliIframe(html) {
        if (!html || typeof html !== 'string') return html;

        // 先保护 <code> 和 <pre> 内的内容
        var codeBlocks = [];
        html = html.replace(/<pre><code[\s\S]*?<\/code><\/pre>|<code>[^<]*<\/code>/gi, function (m) {
            codeBlocks.push(m);
            return '\u0000HF' + (codeBlocks.length - 1) + '\u0000';
        });

        html = html.replace(
            /<iframe\s+([^>]*?)src=["']\/\/(?:player\.)?bilibili\.com\/player\.html\?([^"']*)["']([^>]*)><\/iframe>/gi,
            function (match, before, queryString, after) {
                // 已经是目标格式（blackboard html5mobileplayer）则跳过
                if (/bilibili\.com\/blackboard\/html5mobileplayer\.html/i.test(match)) return match;

                var params = new URLSearchParams(queryString);
                var bvid = params.get('bvid');
                var aid = params.get('aid');
                var cid = params.get('cid');
                var p = params.get('p') || '1';
                if (!bvid && !aid) return match;
                var videoId = bvid || ('av' + aid);
                var src = buildPlayerSrc(bvid || aid, aid, cid, p);
                return '<a href="https://www.bilibili.com/video/' + encodeURIComponent(videoId) +
                    '" target="_blank" rel="noopener noreferrer">前往bilibili</a>\n' +
                    '<iframe id="biliPlayer" src="' + src + '" allowfullscreen="true" width="100%" height="350" scrolling="no" frameborder="0"></iframe>';
            }
        );

        // 恢复代码块
        for (var i = 0; i < codeBlocks.length; i++) {
            html = html.split('\u0000HF' + i + '\u0000').join(codeBlocks[i]);
        }
        return html;
    }

    // 挂载到 window，方便其他模块调用
    window.App = window.App || {};
    window.App.replaceBilibiliIframe = replaceBilibiliIframe;

    // --- 补丁 parseMarkdown ---

    function patchParseMarkdown() {
        var _origParse = window.App.parseMarkdown;
        if (!_origParse) return false;

        window.App.parseMarkdown = function (text, inline) {
            // 预处理：在原始文本中替换 【文案】 bilibili_url
            var processed = text;
            if (!inline && processed) {
                processed = preprocessBilibiliText(processed);
            }
            var html = _origParse(processed, inline);
            // 后处理：替换旧版 iframe（用户直接粘贴的 iframe 代码）
            if (!inline && html) {
                html = replaceBilibiliIframe(html);
            }
            return html;
        };
        return true;
    }

    if (!patchParseMarkdown()) {
        var checkTimer = setInterval(function () {
            if (patchParseMarkdown()) clearInterval(checkTimer);
        }, 10);
    }

    // --- 补丁 renderTimeline：渲染完后立即尝试解析 b23 占位 ---

    function patchRenderTimeline() {
        var _origRender = window.App.renderTimeline;
        if (!_origRender) return false;

        window.App.renderTimeline = function (reset) {
            _origRender(reset);
            // 等一帧让 DOM 完成更新
            setTimeout(resolvePendingB23, 0);
        };
        return true;
    }

    // renderTimeline 可能定义得较晚，也要等
    (function waitForRender() {
        if (!patchRenderTimeline()) {
            setTimeout(waitForRender, 50);
        }
    })();
})();
