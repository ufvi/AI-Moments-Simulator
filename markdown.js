(function () {
    if (typeof window.marked === 'undefined') {
        console.error('[Markdown] marked 未加载');
        return;
    }

    // ---------- 基础配置 ----------
    marked.setOptions({
        html: true,
        breaks: true,
        gfm: true
    });

    // ---------- 1. 自定义剧透语法 ||...|| ----------
    var spoilerExt = {
        name: 'spoiler',
        level: 'inline',
        start: function (src) { return src.indexOf('||'); },
        tokenizer: function (src) {
            var match = src.match(/^\|\|([\s\S]*?)\|\|/);
            if (match) {
                return { type: 'spoiler', raw: match[0], text: match[1] };
            }
        },
        renderer: function (token) {
            return '<span class="spoiler">' + token.text + '</span>';
        }
    };
    marked.use({ extensions: [spoilerExt] });

    // ---------- 2. 安全 URL 校验 ----------
    function isSafeUrl(url) {
        if (!url) return false;
        try {
            var parsed = new URL(url, window.location.origin);
            return ['http:', 'https:', 'mailto:'].indexOf(parsed.protocol) !== -1;
        } catch (e) {
            return /^\/[^/]/.test(url) || /^\.\.?\//.test(url);
        }
    }

    // 自定义渲染器：安全链接 + 安全图片 + 代码复制按钮
    var renderer = new marked.Renderer();

    // 链接覆写：不安全链接只渲染文本
    var _link = renderer.link.bind(renderer);
    renderer.link = function (token) {
        if (!isSafeUrl(token.href)) {
            return this.parser.parseInline(token.tokens);
        }
        return _link(token);
    };

    // 图片覆写：不安全图片退化为 Markdown 文本；安全图片限制最大宽度
    var _image = renderer.image.bind(renderer);
    renderer.image = function (token) {
        if (!isSafeUrl(token.href)) {
            return '![' + (token.text || '') + '](' + token.href + ')';
        }
        return '<img src="' + token.href + '" alt="' + (token.text || '') + '" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;">';
    };

    // 代码块添加复制按钮
    var _code = renderer.code.bind(renderer);
    renderer.code = function (token) {
        return '<div class="code-block-wrapper">' +
               '<button class="code-copy-btn" onclick="copyCode(this)">📋 复制</button>' +
               _code(token).replace('<pre>', '<pre>') +
               '</div>';
    };

    marked.setOptions({ renderer: renderer });

    // ---------- 3. 数学公式处理 (KaTeX) ----------
    // 使用预处理提取公式 → 占位符 → marked 解析 → 后处理渲染
    // 可避免 marked 行内扩展与 codespan 的优先级冲突
    var MATH_BLOCK = '\u0000MB\u0000';
    var MATH_INLINE = '\u0000MI\u0000';

    function extractMath(text) {
        // 1. 保护代码块
        var codeBlocks = [];
        text = text.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, function (m) {
            codeBlocks.push(m);
            return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
        });

        // 2. 提取块级公式 $$...$$
        var mathBlocks = [];
        text = text.replace(/\$\$\n?([\s\S]*?)\$\$/g, function (_, f) {
            mathBlocks.push(f.trim());
            return MATH_BLOCK + (mathBlocks.length - 1) + MATH_BLOCK;
        });

        // 3. 提取行内公式 $...$
        // 要求：$ 内至少一个字符，且首尾不能是空格
        var mathInlines = [];
        text = text.replace(/\$([^\s$](?:[^$]*[^\s$])?)\$/g, function (_, f) {
            mathInlines.push(f);
            return MATH_INLINE + (mathInlines.length - 1) + MATH_INLINE;
        });

    // 4. 恢复代码块
        for (var i = 0; i < codeBlocks.length; i++) {
            text = text.replace('\u0000CB' + i + '\u0000', codeBlocks[i]);
        }

        return { text: text, mathBlocks: mathBlocks, mathInlines: mathInlines };
    }

    function restoreMath(text, mathBlocks, mathInlines) {
        if (typeof window.katex !== 'undefined') {
            // 块级公式
            for (var i = 0; i < mathBlocks.length; i++) {
                try {
                    var rendered = window.katex.renderToString(mathBlocks[i], {
                        displayMode: true,
                        throwOnError: false
                    });
                    // 用 <p> 包裹，与原始行为一致
                    text = text.replace(MATH_BLOCK + i + MATH_BLOCK, '<p>' + rendered + '</p>');
                } catch (e) {
                    text = text.replace(MATH_BLOCK + i + MATH_BLOCK, '$$' + mathBlocks[i] + '$$');
                }
            }
            // 行内公式
            for (var j = 0; j < mathInlines.length; j++) {
                try {
                    var rendered = window.katex.renderToString(mathInlines[j], {
                        displayMode: false,
                        throwOnError: false
                    });
                    text = text.replace(MATH_INLINE + j + MATH_INLINE, rendered);
                } catch (e) {
                    text = text.replace(MATH_INLINE + j + MATH_INLINE, '$' + mathInlines[j] + '$');
                }
            }
        } else {
            // 无 KaTeX 则恢复原 Markdown
            for (var k = 0; k < mathBlocks.length; k++) {
                text = text.replace(MATH_BLOCK + k + MATH_BLOCK, '$$' + mathBlocks[k] + '$$');
            }
            for (var l = 0; l < mathInlines.length; l++) {
                text = text.replace(MATH_INLINE + l + MATH_INLINE, '$' + mathInlines[l] + '$');
            }
        }
        return text;
    }

    // ---------- 4. 暴露解析函数 ----------

    /**
     * 后处理：修复 Marked 因严格遵循 CommonMark 而未解析的 **...** 加粗。
     * 当 ** 紧跟引号等标点（如 **"..."**）且紧邻中文字符时，
     * CommonMark 的 left-flanking 规则会判定 ** 无效，导致不生成 <strong>。
     * 这里对 HTML 中残留的字面量 ** 做一次兜底转换。
     */
    function fixUnconvertedBold(html) {
        // 保护 <code> / <pre> 内部（避免代码块中的 ** 被错误转换）
        var codeBlocks = [];
        html = html.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1>/g, function (m) {
            codeBlocks.push(m);
            return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
        });
        // 把 marked 未转换的 **...** 转为 <strong>
        html = html.replace(/\*\*([^<*]{1,}?)\*\*/g, '<strong>$1</strong>');
        // 恢复代码块
        for (var i = 0; i < codeBlocks.length; i++) {
            html = html.replace('\u0000CB' + i + '\u0000', codeBlocks[i]);
        }
        return html;
    }

    function parseMarkdown(text, inline) {
        if (!text || typeof text !== 'string') return '';
        try {
            if (inline) {
                // 行内模式只需处理行内公式
                var im = extractMath(text);
                var result = marked.parseInline(im.text);
                result = restoreMath(result, im.mathBlocks, im.mathInlines);
                result = fixUnconvertedBold(result);
                return result;
            }
            var em = extractMath(text);
            var result = marked.parse(em.text);
            result = restoreMath(result, em.mathBlocks, em.mathInlines);
            result = fixUnconvertedBold(result);
            return result;
        } catch (err) {
            console.error('[Markdown] 解析错误', err);
            return escapeHtml(text).replace(/\n/g, '<br>');
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>]/g, function (m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    window.App = window.App || {};
    window.App.parseMarkdown = parseMarkdown;

    function parseMarkdownAI(text) {
        if (!text || typeof text !== 'string') return '';
        try {
            var em = extractMath(text);
            marked.setOptions({ breaks: false });
            var result = marked.parse(em.text);
            marked.setOptions({ breaks: true });
            result = restoreMath(result, em.mathBlocks, em.mathInlines);
            result = fixUnconvertedBold(result);
            return result;
        } catch (err) {
            console.error('[Markdown] AI解析错误', err);
            marked.setOptions({ breaks: true });
            return escapeHtml(text);
        }
    }
    window.App.parseMarkdownAI = parseMarkdownAI;

    // 代码块复制功能
    window.copyCode = function (btn) {
        var code = btn.parentNode.querySelector('code');
        if (!code) return;
        var text = code.textContent.replace(/\n+$/, '');
        navigator.clipboard.writeText(text).then(function () {
            var orig = btn.textContent;
            btn.textContent = '✅ 已复制';
            btn.style.opacity = '1';
            setTimeout(function () { btn.textContent = orig; btn.style.opacity = ''; }, 1500);
        }).catch(function () {
            btn.textContent = '❌ 失败';
            setTimeout(function () { btn.textContent = '📋 复制'; }, 1500);
        });
    };
})();
