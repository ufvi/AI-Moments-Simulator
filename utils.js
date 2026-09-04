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
                // 浏览器无法解码的格式（如非苹果设备上的 HEIC）会停在 onload 之前，
                // 必须显式报错，否则发布流程会一直挂着
                img.onerror = () => reject(new Error('图片格式无法解码（HEIC 等）'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
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

    // ── 安卓“动态照片”（Motion Photo）自动拆轨 ──
    // 部分机型（小米/OPPO 等）的动态照片 jpg 里其实内嵌了【两段视频】：
    //   预览动图（HINT，短小）+ 完整视频（FULL）。
    // 只拿“第一个能解码的”会抽到预览动图，所以这里把所有候选都验一遍，
    // 最后挑 时长最长 / 体积最大 的那段（即完整版）。
    function validateVideoBlob(blob, cb) {
        const url = URL.createObjectURL(blob);
        const v = document.createElement('video');
        let done = false;
        const timer = setTimeout(function () { finish(false, 0); }, 2000);
        function finish(ok, dur) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            cb(ok, dur);
        }
        v.onloadedmetadata = function () {
            finish(v.duration > 0 && !isNaN(v.duration), v.duration || 0);
        };
        v.onerror = function () { finish(false, 0); };
        v.preload = 'metadata';
        v.muted = true;
        v.src = url;
    }

    function tryExtractMotionClip(file) {
        return new Promise(function (resolve) {
            // 总超时保护：任何环节卡住都不能让调用方一直等
            const guard = setTimeout(function () { resolve(null); }, 15000);
            const settle = function (v) { clearTimeout(guard); resolve(v); };
            try {
                if (!file) { settle(null); return; }
                const isJpeg = (file.type || '').indexOf('image/jpeg') === 0 ||
                    (file.name && /\.jpe?g$/i.test(file.name));
                if (!isJpeg) { settle(null); return; }
                const reader = new FileReader();
                reader.onerror = function () { settle(null); };
                reader.onload = function () {
                    try {
                        const bytes = new Uint8Array(reader.result);
                        // 只处理真正的 JPEG（FF D8 FF 开头）
                        if (bytes.length < 16 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) {
                            settle(null);
                            return;
                        }
                        // 从尾部向前找 'ftyp'（MP4 容器开头，内嵌视频一般按 “预览段 + 完整段” 追加在 JPEG 后）
                        // 取最后若干个候选，避免大量误命中拖慢验证
                        const positions = [];
                        for (let i = bytes.length - 5; i >= 4 && positions.length < 12; i--) {
                            if (bytes[i] === 0x66 && bytes[i + 1] === 0x74 &&
                                bytes[i + 2] === 0x79 && bytes[i + 3] === 0x70) {
                                positions.push(i);
                            }
                        }
                        if (!positions.length) { settle(null); return; }
                        // 依次验证所有候选，记录最好的一段
                        //（同一段 mp4 内也可能多次出现 ftyp（如 moov 后移），时长/体积相同的取后一次即可）
                        let best = null; // { blob, dur, size }
                        let idx = 0;
                        function tryNext() {
                            if (idx >= positions.length) {
                                if (best) {
                                    console.log('[Live] 动态照片内嵌候选', positions.length, '个，选中时长', Math.round(best.dur * 10) / 10 + 's', '大小', Math.round(best.size / 1024) + 'KB');
                                    settle(best.blob);
                                } else {
                                    settle(null);
                                }
                                return;
                            }
                            const p = positions[idx++];
                            const start = p - 4;
                            if (start < 0) { tryNext(); return; }
                            const blob = new Blob([bytes.slice(start)], { type: 'video/mp4' });
                            validateVideoBlob(blob, function (ok, dur) {
                                if (ok) {
                                    const size = blob.size;
                                    // 优选：时长更长；时长几乎一样时选体积更大的（更可能是完整版）
                                    if (!best || dur > best.dur + 0.1 ||
                                        (Math.abs(dur - best.dur) <= 0.1 && size > best.size)) {
                                        best = { blob: blob, dur: dur, size: size };
                                    }
                                }
                                tryNext();
                            });
                        }
                        tryNext();
                    } catch (e) { settle(null); }
                };
                reader.readAsArrayBuffer(file);
            } catch (e) { settle(null); }
        });
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
    window.App.tryExtractMotionClip = tryExtractMotionClip;
})();
