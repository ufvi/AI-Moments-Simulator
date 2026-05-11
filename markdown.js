(function () {
    function parseMarkdown(text) {
        if (!text) return '';
        let html = window.App.escapeHtml(text);
        html = html.replace(/^(?:-{3,}|_{3,}|\*{3,})$/gm, '<hr>');
        html = html.replace(/\n/g, '<br>');
        html = html
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/~~(.+?)~~/g, '<del>$1</del>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/__([^_]+)__/g, '<u>$1</u>')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
                try { new URL(url); return `<img src="${url}" alt="${alt}" style="max-width:100%;">`; } catch { return match; }
            })
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
                try { new URL(url); return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`; } catch { return match; }
            })
            .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');

        return html;
    }

    window.App = window.App || {};
    window.App.parseMarkdown = parseMarkdown;
})();
