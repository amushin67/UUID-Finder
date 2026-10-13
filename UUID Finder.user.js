// ==UserScript==
// @name         UUID Finder
// @namespace    https://github.com/amushin67
// @version      1.0
// @description  Fast UUID collect for Reddit and Twitter
// @author       amu必
// @match        *://*.reddit.com/*
// @match        *://reddit.com/*
// @match        *://x.com/*
// @match        *://twitter.com/*
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @icon         https://raw.githubusercontent.com/amushin67/Medias/refs/heads/main/Magnifyingglass_Ani.png
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      grok.com
// @connect      assets.grok.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.__detectiveAniRXLoaded) return;
    window.__detectiveAniRXLoaded = true;

    // =========================================================================
    // HOST + CONSTANTS
    // =========================================================================
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    const isReddit = host === 'reddit.com' || host.endsWith('.reddit.com');
    const isX      = host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com');
    if (!isReddit && !isX) return;

    const THUMB_SIZE = 64;
    const VALIDATE_CONCURRENCY = 16;
    const COMMENT_FETCH_CONCURRENCY = 8;
    const UUID_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    const MAKE_IMAGINE_LINK = uuid => `https://grok.com/imagine/post/${uuid}`;
    const MAKE_THUMB_LINK  = uuid => `https://grok.com/imagine/post/${uuid}/image`;

    const thumbCache = new Map();
    const metaCache  = new Map();
    const thumbInflight = new Map();
    const validSet = new Set();
    const invalidSet = new Set();

    // =========================================================================
    // STYLES
    // =========================================================================
    GM_addStyle(`
        .dani-thumbs {
            display: flex !important; flex-wrap: wrap !important; gap: 6px !important;
            margin: 8px 0 12px 0 !important; padding: 0 4px 0 8px !important;
            max-width: 100% !important; clear: both !important; box-sizing: border-box !important;
        }
        .dani-thumb {
            width: ${THUMB_SIZE}px !important; height: ${THUMB_SIZE}px !important;
            border-radius: 8px !important; overflow: hidden !important; cursor: pointer !important;
            position: relative !important; flex-shrink: 0 !important;
            border: 1px solid rgba(255,255,255,.12) !important; background: #1a1a22 !important;
            transition: transform .15s ease, border-color .15s ease !important;
            touch-action: manipulation !important; display: flex !important;
            align-items: center !important; justify-content: center !important; box-sizing: border-box !important;
        }
        .dani-thumb:hover { transform: scale(1.06) !important; border-color: rgba(100,200,255,.65) !important; }
        .dani-thumb img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block !important; }
        .dani-thumb.missing-thumb {
            flex-direction: column !important; gap: 2px !important;
            border-color: rgba(251,191,36,.45) !important;
            background: linear-gradient(135deg,#1a1a22 0%,#2a2a35 100%) !important;
        }
        .dani-thumb.missing-thumb .ph-missing {
            font-size: 10px !important; font-weight: 700 !important; line-height: 1.15 !important;
            text-align: center !important; color: rgba(251,191,36,.95) !important;
            white-space: pre-line !important; pointer-events: none !important; padding: 0 4px !important;
        }
        .dani-thumb .badge {
            position: absolute !important; bottom: 3px !important; right: 3px !important;
            background: rgba(0,0,0,0.75) !important; color: #fff !important; font-size: 10px !important;
            padding: 1px 4px !important; border-radius: 4px !important; pointer-events: none !important;
        }
        #dani-detail-panel {
            position: fixed !important; z-index: 2147483647 !important; display: none !important;
            flex-direction: column !important; width: 340px !important; height: 640px !important;
            max-width: calc(100vw - 16px) !important; max-height: calc(100vh - 16px) !important;
            overflow: hidden !important; padding: 0 !important; border-radius: 14px !important;
            background: rgba(16,15,14,.98) !important; border: 1px solid rgba(255,255,255,.14) !important;
            box-shadow: 0 16px 48px rgba(0,0,0,.65) !important; color: #f0ebe6 !important;
            font-size: 12px !important; line-height: 1.45 !important;
            font-family: system-ui, -apple-system, sans-serif !important;
            -webkit-overflow-scrolling: touch !important; box-sizing: border-box !important;
        }
        #dani-detail-panel.open { display: flex !important; }
        #dani-detail-panel .dp-head {
            display: flex !important; align-items: center !important; justify-content: space-between !important;
            padding: 10px 12px 8px !important; border-bottom: 1px solid rgba(255,255,255,.08) !important; flex-shrink: 0 !important;
        }
        #dani-detail-panel .dp-title { font-size: 13px !important; font-weight: 600 !important; opacity: .9 !important; }
        #dani-detail-panel .dp-close {
            width: 28px !important; height: 28px !important; border: none !important; border-radius: 8px !important;
            background: rgba(255,255,255,.08) !important; color: #fff !important; font-size: 16px !important;
            cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important;
            padding: 0 !important; touch-action: manipulation !important;
        }
        #dani-detail-panel .dp-close:hover { background: rgba(255,255,255,.16) !important; }
        #dani-detail-panel .dp-body { overflow-y: auto !important; padding: 12px !important; flex: 1 !important; min-height: 0 !important; }
        #dani-detail-panel .dp-thumb-wrap {
            display: flex !important; justify-content: center !important; margin-bottom: 12px !important;
            border-radius: 10px !important; overflow: hidden !important; background: #1a1918 !important; flex-shrink: 0 !important;
        }
        #dani-detail-panel .dp-thumb {
            height: 200px !important; width: auto !important; max-width: 100% !important;
            object-fit: contain !important; display: block !important; background: #1a1918 !important;
        }
        #dani-detail-panel .dp-row { margin-bottom: 8px !important; font-size: 12px !important; line-height: 1.45 !important; }
        #dani-detail-panel .dp-label {
            display: block !important; opacity: .5 !important; font-weight: 600 !important; font-size: 10px !important;
            text-transform: uppercase !important; letter-spacing: .04em !important; margin-bottom: 2px !important;
        }
        #dani-detail-panel .dp-value { word-break: break-word !important; }
        #dani-detail-panel .dp-uuid {
            font-family: ui-monospace, monospace !important; font-size: 11px !important;
            word-break: break-all !important; opacity: .9 !important;
        }
        #dani-detail-panel .dp-prompt-box {
            margin-top: 4px !important; padding: 10px !important; background: rgba(255,255,255,.04) !important;
            border: 1px solid rgba(255,255,255,.08) !important; border-radius: 8px !important;
            white-space: pre-wrap !important; word-break: break-word !important;
            max-height: calc(1.5em * 6 + 20px) !important; overflow-y: auto !important;
            font-size: 12px !important; line-height: 1.5 !important;
        }
        #dani-detail-panel .dp-prompt-empty { opacity: .5 !important; font-style: italic !important; }
        #dani-detail-panel .dp-actions {
            display: flex !important; flex-wrap: wrap !important; gap: 8px !important;
            padding: 10px 12px 12px !important; border-top: 1px solid rgba(255,255,255,.08) !important; flex-shrink: 0 !important;
        }
        #dani-detail-panel .dp-btn {
            display: inline-flex !important; align-items: center !important; justify-content: center !important;
            gap: 6px !important; padding: 8px 12px !important; border-radius: 8px !important; border: none !important;
            font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important;
            touch-action: manipulation !important; text-decoration: none !important; color: #fff !important;
        }
        #dani-detail-panel .dp-btn-open { background: #299fff !important; }
        #dani-detail-panel .dp-btn-open:hover { background: #1a8ee6 !important; }
        #dani-detail-panel .dp-btn-copy {
            background: rgba(255,255,255,.1) !important; border: 1px solid rgba(255,255,255,.14) !important;
        }
        #dani-detail-panel .dp-btn-copy:hover { background: rgba(255,255,255,.18) !important; }
        #dani-detail-panel .dp-btn-copy.copied { background: #16a34a !important; border-color: transparent !important; }
        #dani-detail-panel .dp-loading { opacity: .6 !important; font-style: italic !important; }
        @media (max-width: 767px) { .dani-thumb { width: 72px !important; height: 72px !important; } }
        @media (max-width: 900px), (max-height: 560px) {
            #dani-detail-panel {
                width: min(100vw - 12px, 340px) !important; height: min(100dvh - 12px, 640px) !important;
                max-width: calc(100vw - 12px) !important; max-height: calc(100dvh - 12px) !important;
            }
        }
    `);

    // =========================================================================
    // DETECTION
    // =========================================================================
    function decodeEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/');
    }

    function expandEncodings(text) {
        const parts = [decodeEntities(text)];
        try { parts.push(decodeURIComponent(parts[0].replace(/\+/g, ' '))); } catch {}
        try { parts.push(decodeURIComponent(parts[parts.length - 1])); } catch {}
        return parts.join('\n');
    }

    function extractGrokUUIDs(text) {
        const decoded = expandEncodings(text);
        const uuids = new Set();
        const patterns = [
            /(?:https?:\/\/)?(?:www\.)?grok\.com\/imagine\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
            /(?:https?:\/\/)?(?:www\.)?grok\.com\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
            /(?:https?:\/\/)?(?:www\.)?assets\.grok\.com\/[^\s"'<>]*?(?:post|imagine)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
            /out\.reddit\.com\/[^\s"'<>]*?grok\.com\/(?:imagine\/)?post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
            /grok[-_.\s]?(?:video|image|img|post|media|gen|generated)?[-_.\s]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
            /(?:^|[\s\/\\"'<>(])grok[^\s"'<>]{0,48}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
        ];
        for (const re of patterns) {
            let m; re.lastIndex = 0;
            while ((m = re.exec(decoded)) !== null) {
                if (m[1] && UUID_STRICT.test(m[1])) uuids.add(m[1].toLowerCase());
            }
        }
        return [...uuids];
    }

    function extractBareUUIDs(text) {
        const decoded = expandEncodings(text);
        const uuids = new Set();
        let m; UUID_GLOBAL.lastIndex = 0;
        while ((m = UUID_GLOBAL.exec(decoded)) !== null) {
            const u = m[0].toLowerCase();
            if (UUID_STRICT.test(u)) uuids.add(u);
        }
        return [...uuids];
    }

    // =========================================================================
    // FAST PARALLEL VALIDATION (strict — no false positives)
    // =========================================================================
    function isRealAsset(uuid) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://grok.com/rest/assets/' + encodeURIComponent(uuid),
                headers: { Accept: 'application/json' },
                timeout: 7000,
                onload(res) {
                    if (res.status === 404 || res.status < 200 || res.status >= 300) {
                        resolve(false); return;
                    }
                    const text = (res.responseText || '').trimStart();
                    if (text.startsWith('{"a')) { resolve(true); return; }
                    try {
                        const data = JSON.parse(text);
                        const asset = data?.asset ?? data;
                        if (asset && typeof asset === 'object' &&
                            !asset.code && asset.message !== 'Asset not found' &&
                            (asset.assetId || asset.id || asset.mimeType || asset.mime_type ||
                             asset.mediaGenInput || asset.ownerUserId || asset.key || asset.auxKeys)) {
                            resolve(true); return;
                        }
                    } catch {}
                    resolve(false);
                },
                onerror() { resolve(false); },
                ontimeout() { resolve(false); }
            });
        });
    }

    function buildCdnThumbList(uuid, asset) {
        const list = [];
        const u = String(uuid).toLowerCase();
        const owner = asset?.ownerUserId || asset?.owner_user_id || null;
        const aux = (asset && asset.auxKeys) || {};
        const push = (url) => {
            if (!url || typeof url !== 'string') return;
            let s = url.trim();
            if (!s) return;
            if (!/^https?:\/\//i.test(s)) s = 'https://assets.grok.com/' + s.replace(/^\//, '');
            if (!s.includes('cache=')) s += (s.includes('?') ? '&' : '?') + 'cache=1';
            list.push(s);
        };
        push(aux['preview-image-256']);
        push(aux['preview-image'] || asset?.previewImageKey);
        if (asset?.key) push(asset.key);
        if (owner) {
            push(`https://assets.grok.com/users/${owner}/generated/${u}/preview_image_256.jpg`);
            push(`https://assets.grok.com/users/${owner}/generated/${u}/preview_image.jpg`);
            push(`https://assets.grok.com/users/${owner}/generated/${u}/image.jpg`);
        }
        push(`https://assets.grok.com/generated/${u}/preview_image_256.jpg`);
        push(`https://assets.grok.com/generated/${u}/preview_image.jpg`);
        push(MAKE_THUMB_LINK(u));
        return [...new Set(list)];
    }

    function probeImgUrl(url, timeoutMs = 1800) {
        return new Promise(resolve => {
            if (!url) return resolve(null);
            const img = new Image();
            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                img.onload = img.onerror = null;
                try { img.removeAttribute('src'); } catch {}
                resolve(ok ? url : null);
            };
            const timer = setTimeout(() => finish(false), timeoutMs);
            img.referrerPolicy = 'no-referrer';
            img.decoding = 'async';
            img.onload = () => finish(img.naturalWidth > 8 && img.naturalHeight > 8);
            img.onerror = () => finish(false);
            img.src = url;
        });
    }

    function fetchAssetMeta(uuid) {
        const key = String(uuid).toLowerCase();
        if (metaCache.has(key)) return Promise.resolve(metaCache.get(key));
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://grok.com/rest/assets/' + encodeURIComponent(key),
                headers: { Accept: 'application/json' },
                timeout: 7000,
                onload(r) {
                    if (r.status < 200 || r.status >= 300) {
                        metaCache.set(key, null); resolve(null); return;
                    }
                    try {
                        const data = JSON.parse(r.responseText);
                        const asset = data?.asset ?? data;
                        metaCache.set(key, asset);
                        resolve(asset);
                    } catch {
                        metaCache.set(key, null); resolve(null);
                    }
                },
                onerror() { metaCache.set(key, null); resolve(null); },
                ontimeout() { metaCache.set(key, null); resolve(null); }
            });
        });
    }

    function checkImage(uuid) {
        const key = String(uuid).toLowerCase();
        if (invalidSet.has(key)) return Promise.resolve(null);
        if (thumbCache.has(key)) return Promise.resolve(thumbCache.get(key));
        if (thumbInflight.has(key)) return thumbInflight.get(key);

        const job = (async () => {
            try {
                const [direct, asset] = await Promise.all([
                    probeImgUrl(MAKE_THUMB_LINK(key), 1600),
                    fetchAssetMeta(key)
                ]);

                let assetOk = false;
                if (asset && typeof asset === 'object' &&
                    !asset.code && asset.message !== 'Asset not found' &&
                    (asset.assetId || asset.id || asset.mimeType || asset.mime_type ||
                     asset.mediaGenInput || asset.ownerUserId || asset.key || asset.auxKeys)) {
                    assetOk = true;
                }

                if (direct) {
                    const result = { ok: true, thumb: direct, missingThumb: false, kind: 'Image' };
                    thumbCache.set(key, result); validSet.add(key); return result;
                }

                if (assetOk) {
                    const candidates = buildCdnThumbList(key, asset)
                        .filter(u => u !== MAKE_THUMB_LINK(key)).slice(0, 2);
                    if (candidates.length) {
                        const hits = await Promise.all(candidates.map(u => probeImgUrl(u, 1400)));
                        const ok = hits.find(Boolean);
                        if (ok) {
                            const result = { ok: true, thumb: ok, missingThumb: false, kind: 'Image' };
                            thumbCache.set(key, result); validSet.add(key); return result;
                        }
                    }
                    const result = { ok: true, thumb: null, missingThumb: true, kind: 'Image' };
                    thumbCache.set(key, result); validSet.add(key); return result;
                }

                const real = await isRealAsset(key);
                if (real) {
                    const result = { ok: true, thumb: null, missingThumb: true, kind: 'Image' };
                    thumbCache.set(key, result); validSet.add(key); return result;
                }

                thumbCache.set(key, null); invalidSet.add(key); return null;
            } catch {
                thumbCache.set(key, null); return null;
            } finally {
                thumbInflight.delete(key);
            }
        })();

        thumbInflight.set(key, job);
        return job;
    }

    /** Validate many UUIDs in parallel with a concurrency pool. */
    async function validateAllParallel(uuidList) {
        const unique = [...new Set(
            uuidList.map(u => String(u).toLowerCase()).filter(u => UUID_STRICT.test(u))
        )];
        const results = new Map();
        const pending = unique.filter(u => {
            if (invalidSet.has(u)) { results.set(u, null); return false; }
            if (thumbCache.has(u)) { results.set(u, thumbCache.get(u)); return false; }
            return true;
        });
        if (!pending.length) return results;

        let idx = 0;
        async function worker() {
            while (idx < pending.length) {
                const i = idx++;
                const uuid = pending[i];
                try {
                    results.set(uuid, await checkImage(uuid));
                } catch {
                    results.set(uuid, null);
                }
            }
        }
        await Promise.all(
            Array.from({ length: Math.min(VALIDATE_CONCURRENCY, pending.length) }, () => worker())
        );
        return results;
    }

    function extractPromptFromAsset(data) {
        if (!data) return '';
        const mgi = data.mediaGenInput;
        if (mgi && typeof mgi === 'object') {
            const KINDS = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'referenceToVideo', 'videoExtension'];
            for (const k of KINDS) {
                const block = mgi[k];
                if (block && typeof block === 'object' && block.prompt) return String(block.prompt).trim();
            }
            for (const value of Object.values(mgi)) {
                if (value && typeof value === 'object' && value.prompt) return String(value.prompt).trim();
            }
        }
        return String(data.summary || data.prompt || data.originalPrompt || '').trim();
    }

    function extractMetaFromAsset(data) {
        if (!data) return { kind: '', ext: '', created: '', prompt: '' };
        const mime = String(data.mimeType || data.mime_type || '').toLowerCase();
        let kind = '', ext = '';
        if (mime.startsWith('video/') || /video/i.test(mime)) {
            kind = 'Video';
            ext = mime.includes('webm') ? '.webm' : (mime.includes('mov') || mime.includes('quicktime') ? '.mov' : '.mp4');
        } else if (mime.startsWith('image/') || mime) {
            kind = 'Image';
            if (mime.includes('png')) ext = '.png';
            else if (mime.includes('webp')) ext = '.webp';
            else if (mime.includes('gif')) ext = '.gif';
            else ext = '.jpg';
        } else {
            const keys = data.mediaGenInput ? Object.keys(data.mediaGenInput).join(' ').toLowerCase() : '';
            if (/video/.test(keys)) { kind = 'Video'; ext = '.mp4'; }
            else { kind = 'Image'; ext = '.jpg'; }
        }
        let created = '';
        const raw = data.createTime || data.createdAt || data.create_time || data.created_at || '';
        if (raw) {
            const d = new Date(raw);
            created = !Number.isNaN(d.getTime())
                ? d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : String(raw);
        }
        return { kind, ext, created, prompt: extractPromptFromAsset(data) };
    }

    // =========================================================================
    // DETAIL PANEL
    // =========================================================================
    let lastPanelUuid = null;
    let panelFixedPos = null;

    function getDetailPanel() {
        let panel = document.getElementById('dani-detail-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'dani-detail-panel';
            document.body.appendChild(panel);
        }
        return panel;
    }

    function hideDetailPanel() {
        const panel = document.getElementById('dani-detail-panel');
        if (panel) panel.classList.remove('open');
        lastPanelUuid = null;
        panelFixedPos = null;
    }

    function positionDetailPanel(anchorEl) {
        const panel = getDetailPanel();
        if (panelFixedPos) {
            panel.style.left = panelFixedPos.left + 'px';
            panel.style.top = panelFixedPos.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            return;
        }
        const winW = window.innerWidth, winH = window.innerHeight;
        const r = (anchorEl || document.body).getBoundingClientRect();
        const pw = 340, ph = 640;
        let left = r.right + 12;
        if (left + pw > winW - 8) left = Math.max(8, r.left - pw - 12);
        if (left < 8) left = 8;
        let top = r.top;
        if (top + ph > winH - 8) top = Math.max(8, winH - ph - 8);
        if (top < 8) top = 8;
        left = Math.round(left); top = Math.round(top);
        panelFixedPos = { left, top };
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = '340px';
        panel.style.height = '640px';
    }

    function buildPanelContent(panel, info) {
        panel.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'dp-head';
        const title = document.createElement('div');
        title.className = 'dp-title';
        title.textContent = info.title || 'Grok reference';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'dp-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); hideDetailPanel(); };
        head.appendChild(title);
        head.appendChild(closeBtn);
        panel.appendChild(head);

        const body = document.createElement('div');
        body.className = 'dp-body';
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'dp-thumb-wrap';
        const big = document.createElement('img');
        big.className = 'dp-thumb';
        big.alt = '';
        big.loading = 'lazy';
        if (info.thumb) big.src = info.thumb;
        else {
            big.src = MAKE_THUMB_LINK(info.uuid);
            big.onerror = () => { big.style.display = 'none'; };
        }
        thumbWrap.appendChild(big);
        body.appendChild(thumbWrap);

        if (info.kind || info.ext) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">File Type</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = info.kind && info.ext ? `${info.kind}${info.ext}` : (info.kind || info.ext || '—');
            row.appendChild(val);
            body.appendChild(row);
        }
        if (info.created) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Created</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = info.created;
            row.appendChild(val);
            body.appendChild(row);
        }
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">UUID</span>';
            const val = document.createElement('div');
            val.className = 'dp-value dp-uuid';
            val.textContent = info.uuid;
            row.appendChild(val);
            body.appendChild(row);
        }
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Prompt</span>';
            const box = document.createElement('div');
            box.className = 'dp-prompt-box';
            const text = (info.prompt || '').trim();
            if (text) box.textContent = text;
            else { box.classList.add('dp-prompt-empty'); box.textContent = '(not available)'; }
            row.appendChild(box);
            body.appendChild(row);
        }
        panel.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'dp-actions';
        const openLink = document.createElement('a');
        openLink.className = 'dp-btn dp-btn-open';
        openLink.href = MAKE_IMAGINE_LINK(info.uuid);
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open on Imagine';
        openLink.onclick = e => e.stopPropagation();
        actions.appendChild(openLink);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'dp-btn dp-btn-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy prompt';
        copyBtn.onclick = e => {
            e.preventDefault(); e.stopPropagation();
            const text = (info.prompt || '').trim();
            if (!text) return;
            const done = () => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => { copyBtn.textContent = 'Copy prompt'; copyBtn.classList.remove('copied'); }, 1600);
            };
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;';
                    document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); } catch {}
                    ta.remove(); done();
                });
            } else {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); } catch {}
                ta.remove(); done();
            }
        };
        actions.appendChild(copyBtn);
        panel.appendChild(actions);
    }

    async function showDetailPanel(anchorEl, uuid, opts = {}) {
        const u = String(uuid).toLowerCase();
        if (lastPanelUuid === u) { hideDetailPanel(); return; }
        lastPanelUuid = u;

        const panel = getDetailPanel();
        buildPanelContent(panel, {
            title: opts.title || 'Grok reference', uuid: u, thumb: opts.thumb || null,
            kind: opts.kind || '', ext: opts.ext || '', created: opts.created || '', prompt: opts.prompt || ''
        });
        const promptBox = panel.querySelector('.dp-prompt-box');
        if (promptBox && !opts.prompt) {
            promptBox.classList.add('dp-loading');
            promptBox.textContent = 'Loading…';
        }
        panel.classList.add('open');
        requestAnimationFrame(() => positionDetailPanel(anchorEl));

        let thumb = opts.thumb || null;
        if (!thumb) {
            try {
                const vr = await checkImage(u);
                if (vr && vr.thumb) thumb = vr.thumb;
            } catch {}
        }
        let asset = null;
        try { asset = await fetchAssetMeta(u); } catch {}
        const meta = extractMetaFromAsset(asset);
        const prompt = opts.prompt || meta.prompt || '';

        buildPanelContent(panel, {
            title: opts.title || 'Grok reference', uuid: u, thumb: thumb || null,
            kind: meta.kind || opts.kind || '', ext: meta.ext || opts.ext || '',
            created: meta.created || opts.created || '', prompt
        });
        requestAnimationFrame(() => positionDetailPanel(anchorEl));
    }

    document.addEventListener('click', e => {
        const panel = document.getElementById('dani-detail-panel');
        if (panel && panel.classList.contains('open') &&
            !panel.contains(e.target) && !e.target.closest('.dani-thumb')) {
            hideDetailPanel();
        }
    }, true);

    // =========================================================================
    // THUMB UI — only from already-validated results
    // =========================================================================
    function createValidatedThumb(uuid, result) {
        const item = document.createElement('div');
        item.className = 'dani-thumb' + (result.thumb ? '' : ' missing-thumb');
        item.title = `Click for details\n${uuid}`;

        if (result.thumb) {
            const img = document.createElement('img');
            img.src = result.thumb;
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.alt = '';
            item.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.className = 'ph-missing';
            span.textContent = 'No preview';
            item.appendChild(span);
        }
        if (String(result.kind || '').toLowerCase() === 'video' || result.isVideo) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = '▶';
            item.appendChild(badge);
        }
        item.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            showDetailPanel(item, uuid, {
                thumb: result.thumb || null, kind: result.kind || '', isVideo: !!result.isVideo
            });
        });
        return item;
    }

    function buildThumbsFromValidated(list, extraMap) {
        const items = [];
        const seen = new Set();
        for (const { uuid, result } of list) {
            if (!result || !result.ok) continue;
            const u = uuid.toLowerCase();
            if (seen.has(u)) continue;
            seen.add(u);
            const extra = extraMap ? extraMap.get(u) : null;
            items.push(createValidatedThumb(u, {
                ...result, isVideo: extra ? !!extra.isVideo : !!result.isVideo
            }));
        }
        if (!items.length) return null;
        const box = document.createElement('div');
        box.className = 'dani-thumbs';
        for (const it of items) box.appendChild(it);
        return box;
    }

    // =========================================================================
    // INSERTION BELOW MEDIA
    // =========================================================================
    function findMediaBlockReddit(postEl) {
        const sels = [
            '[slot="post-media-container"]', 'shreddit-aspect-ratio',
            '[data-testid="post-media"]', 'div[data-click-id="media"]',
            'faceplate-tracker[source="post_media"]', 'gallery-carousel',
            'shreddit-player', 'shreddit-media-lightbox-host',
            'img[src*="i.redd.it"]', 'img[src*="preview.redd.it"]', 'video', 'img'
        ];
        for (const sel of sels) {
            const el = postEl.querySelector(sel);
            if (el) {
                let block = el;
                for (let i = 0; i < 4 && block && block !== postEl; i++) {
                    const parent = block.parentElement;
                    if (!parent || parent === postEl) break;
                    if (parent.matches?.('[slot="post-media-container"], shreddit-aspect-ratio, [data-testid="post-media"], div[data-click-id="media"]')) {
                        block = parent; break;
                    }
                    block = parent;
                }
                return block;
            }
        }
        return null;
    }

    function findMediaBlockX(article) {
        const mediaEls = [
            ...article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"]')
        ];
        if (!mediaEls.length) {
            const img = article.querySelector('img[src*="pbs.twimg.com/media"], img[src*="twimg.com/media"], video');
            if (img) mediaEls.push(img);
        }
        if (!mediaEls.length) return null;
        let block = mediaEls[0];
        for (let i = 0; i < 8 && block && block !== article; i++) {
            const parent = block.parentElement;
            if (!parent || parent === article) break;
            if (mediaEls.every(m => parent.contains(m))) block = parent;
            else break;
        }
        return block;
    }

    function findActionBarX(article) {
        const groups = article.querySelectorAll('[role="group"]');
        for (const g of groups) {
            if (g.querySelector('[data-testid="reply"], [data-testid="retweet"], [data-testid="like"], a[href*="/analytics"]')) {
                return g;
            }
        }
        return null;
    }

    function insertThumbsBelowMedia(postEl, container, platform) {
        if (!postEl || !container || !postEl.isConnected) return;
        const pid = container.dataset.for || '';
        if (pid) {
            postEl.parentElement?.querySelectorAll(`.dani-thumbs[data-for="${pid}"]`).forEach(el => el.remove());
            postEl.querySelectorAll(`.dani-thumbs[data-for="${pid}"]`).forEach(el => el.remove());
        }
        postEl.querySelectorAll('.dani-thumbs').forEach(el => el.remove());

        if (platform === 'x') {
            const actionBar = findActionBarX(postEl);
            if (actionBar?.parentNode) {
                actionBar.parentNode.insertBefore(container, actionBar);
                return;
            }
            const mediaBlock = findMediaBlockX(postEl);
            if (mediaBlock?.parentNode) {
                if (mediaBlock.nextSibling) mediaBlock.parentNode.insertBefore(container, mediaBlock.nextSibling);
                else mediaBlock.parentNode.appendChild(container);
                return;
            }
            postEl.appendChild(container);
            return;
        }

        const mediaBlock = findMediaBlockReddit(postEl);
        if (mediaBlock?.parentNode) {
            if (mediaBlock.nextSibling) mediaBlock.parentNode.insertBefore(container, mediaBlock.nextSibling);
            else mediaBlock.parentNode.appendChild(container);
            return;
        }
        if (postEl.parentElement) {
            if (postEl.nextSibling) postEl.parentElement.insertBefore(container, postEl.nextSibling);
            else postEl.parentElement.appendChild(container);
        }
    }

    // =========================================================================
    // REDDIT — collect all → validate all → insert
    // =========================================================================
    if (isReddit) {
        const postUuidMap = new Map();
        const processedPosts = new Set();
        const emptyPosts = new Set();
        const commentFetched = new Set();
        let scanning = false;

        function isListing() {
            return /^\/r\/[^/]+\/?(?:hot|new|top|rising|controversial|best)?\/?$/.test(location.pathname) ||
                   /^\/r\/[^/]+\/?$/.test(location.pathname);
        }

        function getPostElements() {
            const list = [...document.querySelectorAll('shreddit-post, [data-testid="post-container"], article[id^="t3_"]')];
            return list.length ? list : [...document.querySelectorAll('#siteTable .thing.link, .linklisting .thing.link')];
        }

        function getCommentsUrl(el) {
            const a = el.querySelector('a[slot="full-post-link"], a[href*="/comments/"], a[data-click-id="body"]');
            if (a?.href && /\/comments\//.test(a.href)) return a.href;
            const perm = el.getAttribute('permalink') || el.getAttribute('content-href');
            if (perm && /\/comments\//.test(perm)) {
                try { return new URL(perm, location.origin).href; } catch {}
            }
            const oldA = el.querySelector('a.comments, a.bylink.comments');
            if (oldA) return oldA.href;
            const dataPerm = el.getAttribute('data-permalink');
            return dataPerm ? location.origin + dataPerm : null;
        }

        function getPostId(url) {
            try {
                const parts = new URL(url).pathname.split('/').filter(Boolean);
                const i = parts.indexOf('comments');
                return i !== -1 && parts[i + 1] ? parts[i + 1].toLowerCase() : url;
            } catch { return url; }
        }

        function hasThumbsFor(el, id) {
            try {
                if (el.parentElement?.querySelector(`.dani-thumbs[data-for="${id}"]`)) return true;
                if (el.querySelector?.('.dani-thumbs')) return true;
            } catch {}
            return false;
        }

        function extractSurfaceUuids(el) {
            let text = '';
            try { text = el.outerHTML || ''; } catch {}
            try {
                text += '\n' + [
                    el.getAttribute('post-title') || '',
                    el.getAttribute('aria-label') || '',
                    el.getAttribute('permalink') || '',
                    el.getAttribute('content-href') || ''
                ].join(' ');
            } catch {}
            return [...new Set([...extractGrokUUIDs(text), ...extractBareUUIDs(text)])];
        }

        async function fetchCommentsText(commentsUrl) {
            const jsonUrl = commentsUrl.replace(/\/+$/, '') + '.json?limit=100&raw_json=1';
            try {
                const res = await fetch(jsonUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                if (res.ok) return decodeEntities(await res.text());
            } catch {}
            return '';
        }

        async function scanReddit() {
            if (!isListing() || scanning) return;
            scanning = true;
            try {
                const posts = getPostElements();
                const postInfos = [];
                const allSurfaceUuids = new Set();

                // PHASE 1 — collect surface UUIDs from every visible post (sync)
                for (const el of posts) {
                    const url = getCommentsUrl(el);
                    if (!url) continue;
                    const id = getPostId(url);
                    if (hasThumbsFor(el, id)) { processedPosts.add(id); continue; }
                    if (emptyPosts.has(id) && processedPosts.has(id)) continue;

                    let surface = postUuidMap.get(id);
                    if (!surface) {
                        surface = extractSurfaceUuids(el);
                        if (surface.length) postUuidMap.set(id, new Set(surface));
                    } else {
                        surface = [...surface];
                    }
                    surface.forEach(u => allSurfaceUuids.add(u));
                    postInfos.push({ el, id, url, surface });
                }

                // PHASE 2 — validate ALL unique surface UUIDs in one parallel batch
                if (allSurfaceUuids.size) {
                    await validateAllParallel([...allSurfaceUuids]);
                }

                // PHASE 3 — insert thumbs for posts that already have valid UUIDs
                const needComments = [];
                for (const info of postInfos) {
                    if (!info.el.isConnected) continue;
                    if (hasThumbsFor(info.el, info.id)) continue;

                    const uuids = postUuidMap.get(info.id) || new Set(info.surface);
                    const validOnes = [...uuids].filter(u => {
                        const r = thumbCache.get(u);
                        return r && r.ok;
                    });

                    if (validOnes.length) {
                        const results = validOnes.map(u => ({ uuid: u, result: thumbCache.get(u) }));
                        const box = buildThumbsFromValidated(results);
                        if (box) {
                            box.dataset.for = info.id;
                            insertThumbsBelowMedia(info.el, box, 'reddit');
                            processedPosts.add(info.id);
                        }
                    } else if (!commentFetched.has(info.id) && !emptyPosts.has(info.id)) {
                        needComments.push(info);
                    }
                }

                // PHASE 4 — parallel comment fetches for remaining posts
                if (needComments.length) {
                    let cIdx = 0;
                    async function commentWorker() {
                        while (cIdx < needComments.length) {
                            const i = cIdx++;
                            const info = needComments[i];
                            if (commentFetched.has(info.id)) continue;
                            commentFetched.add(info.id);
                            try {
                                const text = await fetchCommentsText(info.url);
                                if (!text) {
                                    if (!(postUuidMap.get(info.id)?.size)) emptyPosts.add(info.id);
                                    continue;
                                }
                                const found = [...extractGrokUUIDs(text), ...extractBareUUIDs(text)];
                                if (!found.length) {
                                    if (!(postUuidMap.get(info.id)?.size)) emptyPosts.add(info.id);
                                    continue;
                                }
                                let set = postUuidMap.get(info.id);
                                if (!set) { set = new Set(); postUuidMap.set(info.id, set); }
                                found.forEach(u => set.add(u));

                                await validateAllParallel(found);

                                if (!info.el.isConnected || hasThumbsFor(info.el, info.id)) continue;
                                const validOnes = [...set].filter(u => {
                                    const r = thumbCache.get(u);
                                    return r && r.ok;
                                });
                                if (validOnes.length) {
                                    const results = validOnes.map(u => ({ uuid: u, result: thumbCache.get(u) }));
                                    const box = buildThumbsFromValidated(results);
                                    if (box) {
                                        box.dataset.for = info.id;
                                        insertThumbsBelowMedia(info.el, box, 'reddit');
                                        processedPosts.add(info.id);
                                    }
                                } else {
                                    emptyPosts.add(info.id);
                                }
                            } catch {}
                        }
                    }
                    await Promise.all(
                        Array.from(
                            { length: Math.min(COMMENT_FETCH_CONCURRENCY, needComments.length) },
                            () => commentWorker()
                        )
                    );
                }
            } finally {
                scanning = false;
            }
        }

        function scheduleScan() {
            clearTimeout(window.__daniRedditScan);
            window.__daniRedditScan = setTimeout(() => { scanReddit().catch(() => {}); }, 120);
        }

        function resetReddit() {
            postUuidMap.clear();
            processedPosts.clear();
            emptyPosts.clear();
            commentFetched.clear();
            hideDetailPanel();
        }

        function startReddit() {
            scanReddit().catch(() => {});
            new MutationObserver(() => scheduleScan()).observe(document.body, { childList: true, subtree: true });
            window.addEventListener('scroll', scheduleScan, { passive: true });

            let last = location.href;
            setInterval(() => {
                if (location.href !== last) {
                    last = location.href;
                    resetReddit();
                    setTimeout(() => scanReddit().catch(() => {}), 300);
                    setTimeout(() => scanReddit().catch(() => {}), 1200);
                } else {
                    scheduleScan();
                }
            }, 2000);

            setTimeout(() => scanReddit().catch(() => {}), 400);
            setTimeout(() => scanReddit().catch(() => {}), 1500);
            setTimeout(() => scanReddit().catch(() => {}), 4000);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startReddit);
        } else {
            startReddit();
        }

        console.log('%c[Detective Ani] Reddit v1.2 — parallel collect+validate', 'color:#ff4500;font-weight:bold');
    }

    // =========================================================================
    // X / TWITTER — Fiber collect all → validate all → insert
    // =========================================================================
    if (isX) {
        const tweetCache = new WeakMap();
        const processed = new WeakSet();
        let scanning = false;
        let timer = null;

        function extractMediaObjectsFromFiber(article) {
            const results = [];
            const seen = new Set();

            function add(uuid, isVideo) {
                if (!uuid) return;
                const u = String(uuid).toLowerCase();
                if (!UUID_STRICT.test(u) || seen.has(u)) return;
                seen.add(u);
                results.push({ uuid: u, isVideo: !!isVideo });
            }

            const startEls = [article];
            article.querySelectorAll(
                '[data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"], ' +
                'img[src*="pbs.twimg.com"], img[src*="twimg.com/media"], video'
            ).forEach(el => startEls.push(el));

            for (const el of startEls) {
                let key;
                try {
                    key = Object.keys(el).find(k =>
                        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
                    );
                } catch { continue; }
                if (!key) continue;

                let fiber = el[key];
                let depth = 0;
                while (fiber && depth < 45) {
                    try {
                        if (fiber.memoizedProps) {
                            const str = JSON.stringify(fiber.memoizedProps);

                            const rePost = /"grok_post_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
                            let m;
                            while ((m = rePost.exec(str))) {
                                const chunk = str.slice(Math.max(0, m.index - 400), Math.min(str.length, m.index + 600));
                                const type = (chunk.match(/"type"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const mediaKey = (chunk.match(/"media_key"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const expanded = (chunk.match(/"expanded_url"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const isVideo = type === 'video' || mediaKey.startsWith('13_') ||
                                    expanded.includes('/video/') || chunk.includes('amplify_video') ||
                                    chunk.includes('"video_info"');
                                add(m[1], isVideo);
                            }

                            const reAny = /"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
                            let m2;
                            while ((m2 = reAny.exec(str))) {
                                const around = str.slice(Math.max(0, m2.index - 80), Math.min(str.length, m2.index + 80)).toLowerCase();
                                if (around.includes('grok_post_id') || around.includes('grok.com/imagine') ||
                                    (around.includes('grok') && around.includes('media_key')) ||
                                    (around.includes('imagine') && (around.includes('media_key') || around.includes('expanded_url')))) {
                                    add(m2[1], around.includes('video') || around.includes('13_'));
                                }
                            }
                        }
                    } catch {}
                    fiber = fiber.return;
                    depth++;
                }
            }

            const DIY_RE = /faça\s*voc[eê]\s*mesmo|make\s*your\s*own|try\s*it\s*yourself|try\s*grok|remix|criar\s*o\s*seu|hazlo\s*t[uú]\s*mismo|create\s*your\s*own/i;
            article.querySelectorAll('a[href], button, [role="link"], [role="button"]').forEach(el => {
                try {
                    const href = (el.getAttribute('href') || el.href || '').toString();
                    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
                    if (/grok\.com\/imagine/i.test(href)) {
                        const m = href.match(UUID_STRICT);
                        if (m) add(m[0], false);
                    }
                    if (DIY_RE.test(text)) {
                        if (href) {
                            const m = href.match(UUID_STRICT);
                            if (m) add(m[0], false);
                        }
                        for (const attr of el.attributes || []) {
                            const m = String(attr.value).match(UUID_STRICT);
                            if (m) add(m[0], false);
                        }
                    }
                } catch {}
            });

            article.querySelectorAll('img[src*="pbs.twimg.com"], img[src*="twimg.com/media"], video').forEach(media => {
                const urls = [];
                if (media.src) urls.push(media.src);
                if (media.currentSrc) urls.push(media.currentSrc);
                if (media.srcset) {
                    media.srcset.split(',').forEach(p => {
                        const u = p.trim().split(/\s+/)[0];
                        if (u) urls.push(u);
                    });
                }
                if (media.tagName === 'VIDEO') {
                    media.querySelectorAll('source').forEach(s => s.src && urls.push(s.src));
                }
                for (const u of urls) {
                    try {
                        const filename = decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
                        const generated = filename.match(/_generated_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                        if (generated) { add(generated[1], media.tagName === 'VIDEO'); continue; }
                        if (/grok/i.test(filename)) {
                            const m = filename.match(UUID_STRICT);
                            if (m) add(m[0], media.tagName === 'VIDEO');
                        }
                    } catch {}
                }
            });

            return results;
        }

        function articleHasThumbs(article) {
            try {
                return !!(article.querySelector('.dani-thumbs')?.querySelector('.dani-thumb'));
            } catch { return false; }
        }

        async function scanX() {
            if (scanning) return;
            scanning = true;
            try {
                const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
                const vh = window.innerHeight;
                const batch = [];
                const allUuids = new Set();

                // PHASE 1 — collect Fiber UUIDs from all visible tweets
                for (const article of articles) {
                    if (articleHasThumbs(article)) { processed.add(article); continue; }
                    const rect = article.getBoundingClientRect();
                    if (rect.bottom < -vh * 0.5 || rect.top > vh * 2.0) continue;

                    let objs = tweetCache.get(article);
                    if (!objs) {
                        objs = extractMediaObjectsFromFiber(article);
                        if (objs.length) tweetCache.set(article, objs);
                    }
                    if (!objs.length) continue;
                    objs.forEach(o => allUuids.add(o.uuid));
                    batch.push({ article, objs });
                }

                if (!allUuids.size) return;

                // PHASE 2 — one parallel validation pass for the whole page
                await validateAllParallel([...allUuids]);

                // PHASE 3 — insert only validated thumbs
                for (const { article, objs } of batch) {
                    if (!article.isConnected || articleHasThumbs(article)) continue;
                    const valid = objs.filter(o => {
                        const r = thumbCache.get(o.uuid);
                        return r && r.ok;
                    });
                    if (!valid.length) continue;

                    const extraMap = new Map(valid.map(o => [o.uuid, o]));
                    const results = valid.map(o => ({
                        uuid: o.uuid,
                        result: { ...thumbCache.get(o.uuid), isVideo: o.isVideo }
                    }));
                    const box = buildThumbsFromValidated(results, extraMap);
                    if (box) {
                        insertThumbsBelowMedia(article, box, 'x');
                        processed.add(article);
                    }
                }
            } finally {
                scanning = false;
            }
        }

        function schedule() {
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                scanX().catch(() => {});
            }, 100);
        }

        function startX() {
            new MutationObserver(muts => {
                let need = false;
                for (const m of muts) {
                    if (m.type !== 'childList') continue;
                    for (const n of m.addedNodes) {
                        if (n.nodeType !== 1) continue;
                        if (n.matches?.('article[data-testid="tweet"]') ||
                            n.querySelector?.('article[data-testid="tweet"]') ||
                            n.closest?.('article[data-testid="tweet"]') ||
                            n.matches?.('[data-testid="tweetPhoto"], [data-testid="videoComponent"]') ||
                            n.querySelector?.('[data-testid="tweetPhoto"], [data-testid="videoComponent"]')) {
                            need = true; break;
                        }
                    }
                    if (need) break;
                }
                if (need) schedule();
            }).observe(document.body, { childList: true, subtree: true });

            window.addEventListener('scroll', schedule, { passive: true });
            window.addEventListener('resize', schedule, { passive: true });

            setTimeout(() => scanX().catch(() => {}), 200);
            setTimeout(() => scanX().catch(() => {}), 700);
            setTimeout(() => scanX().catch(() => {}), 1800);
            setInterval(() => scanX().catch(() => {}), 2500);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startX);
        } else {
            startX();
        }

        console.log('%c[Detective Ani] X v1.2 — parallel Fiber collect+validate', 'color:#1da1f2;font-weight:bold');
    }

    console.log('%c[Detective Ani Reddit+X] v1.2.0 — parallel batch validation', 'color:#00ff88;font-weight:bold;font-size:13px');
})();
