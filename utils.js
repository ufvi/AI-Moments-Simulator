(function () {
    function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 0) {
        const d = new Date(ts);
        return `未来 · ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }
    if (diff < 6e4) return '刚刚';
    if (diff < 3.6e6) return Math.floor(diff / 6e4) + '分钟前';
    if (diff < 8.64e7) return Math.floor(diff / 3.6e6) + '小时前';
    if (diff < 6.048e8) {
        const days = Math.floor(diff / 8.64e7);
        const d = new Date(ts);
        return `${days}天前 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s; return d.innerHTML;
    }

    function isEmoji(str) {
        if (!str) return false;
        const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})$/u;
        return emojiRegex.test(str);
    }

    function stripMarkdown(text) {
        if (!text) return '';
        let s = text;
        s = s.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        s = s.replace(/\*\*(.+?)\*\*/g, '$1');
        s = s.replace(/\*(.+?)\*/g, '$1');
        s = s.replace(/~~(.+?)~~/g, '$1');
        s = s.replace(/__(.+?)__/g, '$1');
        s = s.replace(/\|\|(.+?)\|\|/g, '$1');
        s = s.replace(/`(.+?)`/g, '$1');
        s = s.replace(/^(?:-{3,}|_{3,}|\*{3,})$/gm, '');
        s = s.replace(/<[^>]*>/g, '');
        return s;
    }

    function removeSpaces(s) {
        return s.replace(/\s+/g, '');
    }

    function base64ToBlob(b64) {
        const parts = b64.split(','),
            mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
        const bytes = atob(parts[1]),
            arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    function compressImg(file, maxW, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width,
                        h = img.height; if (w > maxW) {
                            h = h * maxW / w;
                            w = maxW;
                        }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const mime = canvasHasAlpha(ctx, w, h) ? 'image/png' : 'image/jpeg';
                    canvas.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), mime,
                        quality);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function canvasHasAlpha(ctx, w, h) {
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) return true;
        }
        return false;
    }

    function compressImgToDataUrl(file, maxW, quality, cb) {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width,
                    h = img.height; if (w > maxW) {
                        h = h * maxW / w;
                        w = maxW;
                    }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const mime = canvasHasAlpha(ctx, w, h) ? 'image/png' : 'image/jpeg';
                cb(canvas.toDataURL(mime, quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    window.App = window.App || {};
    window.App.formatTime = formatTime;
    window.App.escapeHtml = escapeHtml;
    window.App.isEmoji = isEmoji;
    window.App.stripMarkdown = stripMarkdown;
    window.App.removeSpaces = removeSpaces;
    window.App.base64ToBlob = base64ToBlob;
    window.App.compressImg = compressImg;
    window.App.compressImgToDataUrl = compressImgToDataUrl;
})();
