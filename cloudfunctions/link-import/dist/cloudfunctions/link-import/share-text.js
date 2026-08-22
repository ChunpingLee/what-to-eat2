"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShareText = parseShareText;
const url_policy_1 = require("./url-policy");
const URL_CANDIDATE = /(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/[^\s"'<>【】「」（）`，。；、！？]*)?/g;
const BRACKETED_NAME = /[【「]([^】」]{2,40})[】」]/g;
const AMAP_LINK = /(?:surl|uri)\.amap\.com\//;
const LOOKS_LIKE_URL_OR_NUMBER = /https?:\/\/|[\w-]+\.[\w-]+\/|^[¥★☆\d]/;
/**
 * Meituan/Dianping shop pages are login-walled or spider-verified against server-side fetches,
 * but their share messages embed the shop name in brackets: 【店名】推荐语 http://dpurl.cn/xxx.
 * This extracts both parts from a pasted share message; the URL is normalized to https.
 */
function parseShareText(input) {
    const text = input.trim();
    if (!text)
        return undefined;
    let url;
    for (const candidate of text.match(URL_CANDIDATE) ?? []) {
        const trimmed = candidate.replace(/[).,;：；、！？]+$/, '');
        const normalized = trimmed.startsWith('http://')
            ? `https://${trimmed.slice('http://'.length)}`
            : trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
        try {
            (0, url_policy_1.platformForUrl)(normalized);
            url = normalized;
            break;
        }
        catch { /* not a supported platform host; try the next candidate */ }
    }
    let name;
    for (const match of text.matchAll(BRACKETED_NAME)) {
        const candidate = match[1].trim();
        if (candidate && !/https?:\/\/|[\w-]+\.[\w-]+\//.test(candidate)) {
            name = candidate;
            break;
        }
    }
    // AMap share messages put the shop name on the first line without brackets:
    // "店名(分店)\n¥62/人·烤肉\n地址\nhttps://surl.amap.com/xxx".
    if (!name && AMAP_LINK.test(text)) {
        name = text.split('\n')
            .map(line => line.trim())
            .find(line => line.length >= 2 && line.length <= 40 && !LOOKS_LIKE_URL_OR_NUMBER.test(line));
    }
    if (!url && !name)
        return undefined;
    return { ...(url ? { url } : {}), ...(name ? { name } : {}) };
}
