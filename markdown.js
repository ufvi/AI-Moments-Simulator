(function() {
    function parseMarkdown(text) {
    if (!text) return '';
    let html = window.App.escapeHtml(text);
    html = html
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/__([^_]+)__/g, '<u>$1</u>')
        // ===== 图片和链接必须优先处理 =====
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
            try { new URL(url); return `<img src="${url}" alt="${alt}" style="max-width:100%;">`; } catch { return match; }
        })
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
            try { new URL(url); return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`; } catch {
                return match;
            }
        })
        // ===== 最后处理剧透（这样才能包住 <img> 和 <a>）=====
        .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
    return html;
}

    window.App = window.App || {};
    window.App.parseMarkdown = parseMarkdown;
})();
