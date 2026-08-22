"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShareText = parseShareText;
const url_policy_1 = require("./url-policy");
const URL_CANDIDATE = /(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/[^\s"'<>【】「」（）`，。；、！？]*)?/g;
const BRACKETED_NAME = /[【「]([^】」]{2,40})[】」]/g;
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
    if (!url && !name)
        return undefined;
    return { ...(url ? { url } : {}), ...(name ? { name } : {}) };
}
