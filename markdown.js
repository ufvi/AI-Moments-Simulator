(function () {
    // 安全 HTML 转义（若全局未提供，则使用内置实现）
    function escapeHtml(text) {
        if (window.App && window.App.escapeHtml) {
            return window.App.escapeHtml(text);
        }
        // 内置简单转义
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, c => map[c]);
    }

    // 安全 URL 校验（只允许 http、https、mailto 协议，也支持相对路径）
    function isSafeUrl(url) {
        try {
            const parsed = new URL(url, window.location.origin);
            return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    // 内联语法解析（输入已是 escapeHtml 后的安全文本）
    function parseInline(text) {
        let html = text;
        // 粗体、斜体
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // 删除线
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        // 行内代码
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        // 下划线（放宽限制，允许内部包含单下划线）
        html = html.replace(/__(.+?)__/g, '<u>$1</u>');
        // 图片
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
            if (isSafeUrl(url)) {
                return `<img src="${url}" alt="${alt}" style="max-width:100%;">`;
            }
            return match; // 不安全协议则原样显示
        });
        // 链接
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
            if (isSafeUrl(url)) {
                return `<a href="${url}" target="_blank" rel="noopener nofollow ugc">${text}</a>`;
            }
            return match;
        });
        // 剧透
        html = html.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
        return html;
    }

    // 主解析函数
    function parseMarkdown(text) {
        if (!text) return '';

        // 占位符系统，用于保护块级 HTML 不被后续全局转义污染
        const placeholders = [];
        let counter = 0;
        function addPlaceholder(html) {
            const key = `\x00BLOCK${counter++}\x00`;
            placeholders.push({ key, html });
            return key;
        }

        let result = text;

        // 1. 水平分割线（单独匹配整行）
        result = result.replace(/^ {0,3}([-_*])\1{2,} *$/gm, (match) => {
            return addPlaceholder('<hr>');
        });

        // 2. 引用块（连续以 > 开头的行）
        result = result.replace(/^(?:>.*(?:\n|$))+/gm, (match) => {
            const lines = match.split('\n').filter(line => /^>/.test(line));
            const content = lines.map(line => {
                // 去掉 > 和紧随其后的一个可选空格
                const text = line.replace(/^> ?/, '');
                return parseInline(escapeHtml(text));
            }).join('<br>');
            return addPlaceholder(`<blockquote class="blockquote">${content}</blockquote>`);
        });

        // 3. 无序列表（- * +）
        result = result.replace(/^(?: {0,3}[-*+]\s+.+(?:\n {0,3}[-*+]\s+.+)*)/gm, (match) => {
            const items = match.split('\n').map(line => {
                const text = line.replace(/^ {0,3}[-*+]\s+/, '');
                return `<li>${parseInline(escapeHtml(text))}</li>`;
            }).join('');
            return addPlaceholder(`<ul class="md-list">${items}</ul>`);
        });

        // 4. 有序列表（1. 2. ...）
        result = result.replace(/^(?: {0,3}\d+\.\s+.+(?:\n {0,3}\d+\.\s+.+)*)/gm, (match) => {
            const items = match.split('\n').map(line => {
                const text = line.replace(/^ {0,3}\d+\.\s+/, '');
                return `<li>${parseInline(escapeHtml(text))}</li>`;
            }).join('');
            return addPlaceholder(`<ol class="md-list md-list-ordered">${items}</ol>`);
        });

        // 5. 对剩余普通文本进行 HTML 转义
        result = escapeHtml(result);

        // 6. 普通文本中的换行转 <br>（保留原有行为）
        result = result.replace(/\n/g, '<br>');

        // 7. 对普通文本进行内联解析
        result = parseInline(result);

        // 8. 将占位符替换回真实 HTML 块
        placeholders.forEach(({ key, html }) => {
            result = result.replace(key, html);
        });

        // 9. 清理块级元素后多余的 <br>
        result = result.replace(/(<\/(?:ul|ol|blockquote)>|<hr>)\s*<br>/g, '$1');

        return result;
    }

    window.App = window.App || {};
    window.App.parseMarkdown = parseMarkdown;
})();