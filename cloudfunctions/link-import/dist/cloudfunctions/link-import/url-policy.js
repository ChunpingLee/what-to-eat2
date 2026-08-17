"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAllowedPage = exports.LinkImportError = exports.TOTAL_TIMEOUT_MS = exports.MAX_RESPONSE_BYTES = exports.MAX_REDIRECTS = void 0;
exports.unsupportedLink = unsupportedLink;
exports.unavailableLink = unavailableLink;
exports.parseAllowedUrl = parseAllowedUrl;
exports.platformForUrl = platformForUrl;
exports.resolveAllowedUrl = resolveAllowedUrl;
exports.createPinnedHttpsRequest = createPinnedHttpsRequest;
exports.createSafePageFetcher = createSafePageFetcher;
const promises_1 = require("node:dns/promises");
const node_https_1 = require("node:https");
const node_net_1 = require("node:net");
exports.MAX_REDIRECTS = 3;
exports.MAX_RESPONSE_BYTES = 1024 * 1024;
exports.TOTAL_TIMEOUT_MS = 5_000;
class LinkImportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'LinkImportError';
    }
}
exports.LinkImportError = LinkImportError;
function unsupportedLink() {
    return new LinkImportError('UNSUPPORTED_LINK', 'UNSUPPORTED_LINK');
}
function unavailableLink() {
    return new LinkImportError('LINK_UNAVAILABLE', 'Link import is temporarily unavailable');
}
const PLATFORM_BY_HOST = new Map([
    ['www.meituan.com', 'meituan'],
    ['m.meituan.com', 'meituan'],
    ['www.dianping.com', 'dianping'],
    ['m.dianping.com', 'dianping'],
    ['www.amap.com', 'amap'],
    ['ditu.amap.com', 'amap'],
]);
function parseAllowedUrl(input) {
    let url;
    try {
        url = input instanceof URL ? new URL(input.href) : new URL(input);
    }
    catch {
        throw unsupportedLink();
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || !PLATFORM_BY_HOST.get(hostname)) {
        throw unsupportedLink();
    }
    return url;
}
function platformForUrl(input) {
    const platform = PLATFORM_BY_HOST.get(parseAllowedUrl(input).hostname);
    if (!platform)
        throw unsupportedLink();
    return platform;
}
const defaultLookup = async (hostname) => (0, promises_1.lookup)(hostname, { all: true, verbatim: true });
function parseIpv4(address) {
    const values = address.split('.').map(Number);
    return values.length === 4 && values.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
        ? values
        : undefined;
}
function isGlobalIpv4(address) {
    const value = parseIpv4(address);
    if (!value)
        return false;
    const [a, b, c] = value;
    return !(a === 0
        || a === 10
        || a === 100 && b >= 64 && b <= 127
        || a === 127
        || a === 169 && b === 254
        || a === 172 && b >= 16 && b <= 31
        || a === 192 && b === 0
        || a === 192 && b === 88 && c === 99
        || a === 192 && b === 168
        || a === 198 && (b === 18 || b === 19)
        || a === 198 && b === 51 && c === 100
        || a === 203 && b === 0 && c === 113
        || a >= 224);
}
function ipv6Groups(address) {
    let normalized = address;
    const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (dotted) {
        const ipv4 = parseIpv4(dotted);
        if (!ipv4)
            return undefined;
        normalized = normalized.slice(0, -dotted.length)
            + ((ipv4[0] << 8) | ipv4[1]).toString(16)
            + ':' + ((ipv4[2] << 8) | ipv4[3]).toString(16);
    }
    const halves = normalized.split('::');
    if (halves.length > 2)
        return undefined;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const omitted = halves.length === 2 ? 8 - left.length - right.length : 0;
    const groups = [...left, ...Array.from({ length: omitted }, () => '0'), ...right];
    if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group)))
        return undefined;
    return groups.map(group => Number.parseInt(group, 16));
}
function isGlobalAddress(address) {
    const normalized = address.toLowerCase().split('%')[0];
    if ((0, node_net_1.isIP)(normalized) === 4)
        return isGlobalIpv4(normalized);
    if ((0, node_net_1.isIP)(normalized) !== 6)
        return false;
    const groups = ipv6Groups(normalized);
    if (!groups)
        return false;
    const ipv4Embedded = groups.slice(0, 4).every(group => group === 0)
        && (groups[4] === 0xffff || groups[5] === 0xffff);
    if (ipv4Embedded)
        return false;
    const globallyAllocated = groups[0] >= 0x2000 && groups[0] <= 0x3fff;
    const reserved2001 = groups[0] === 0x2001 && groups[1] <= 0x01ff;
    const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8
        || groups[0] >= 0x3ff0 && groups[0] <= 0x3fff;
    const transition = groups[0] === 0x2002;
    return globallyAllocated && !reserved2001 && !documentation && !transition;
}
function canonicalAddress(address) {
    const normalized = address.toLowerCase().split('%')[0];
    if ((0, node_net_1.isIP)(normalized) === 4)
        return parseIpv4(normalized)?.join('.');
    if ((0, node_net_1.isIP)(normalized) !== 6)
        return undefined;
    return ipv6Groups(normalized)?.map(group => group.toString(16)).join(':');
}
async function resolveAllowedUrl(input, lookup = defaultLookup, signal) {
    const url = parseAllowedUrl(input);
    if (signal?.aborted)
        throw unavailableLink();
    let addresses;
    try {
        addresses = await lookup(url.hostname, signal);
    }
    catch {
        throw unavailableLink();
    }
    if (signal?.aborted)
        throw unavailableLink();
    if (!addresses.length || addresses.some(result => !isGlobalAddress(result.address)
        || result.family !== (0, node_net_1.isIP)(result.address)
        || result.family !== 4 && result.family !== 6))
        throw unsupportedLink();
    const selected = addresses[0];
    return { url, address: selected.address, family: selected.family };
}
function createPinnedHttpsRequest(transport = node_https_1.request) {
    return (target, signal) => new Promise((resolve, reject) => {
        let verified = false;
        const fixedLookup = ((_hostname, _options, callback) => {
            callback(null, target.address, target.family);
        });
        const request = transport(target.url, {
            method: 'GET',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'user-agent': 'most-want-to-eat-link-import/1.0',
            },
            lookup: fixedLookup,
            servername: target.url.hostname,
            rejectUnauthorized: true,
            agent: false,
            signal,
        }, response => {
            if (!verified) {
                request.destroy(unavailableLink());
                return;
            }
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
        });
        request.once('socket', socket => {
            socket.once('secureConnect', () => {
                const remote = socket.remoteAddress;
                if (!remote || !isGlobalAddress(remote) || canonicalAddress(remote) !== canonicalAddress(target.address)) {
                    request.destroy(unavailableLink());
                    return;
                }
                verified = true;
            });
        });
        request.once('error', reject);
        request.end();
    });
}
const defaultRequest = createPinnedHttpsRequest();
function header(headers, name) {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
}
async function readLimitedBody(response, signal) {
    const declared = Number(header(response.headers, 'content-length'));
    if (Number.isFinite(declared) && declared > exports.MAX_RESPONSE_BYTES)
        throw unavailableLink();
    const parts = [];
    let bytes = 0;
    for await (const chunk of response.body) {
        if (signal.aborted)
            throw unavailableLink();
        bytes += chunk.byteLength;
        if (bytes > exports.MAX_RESPONSE_BYTES)
            throw unavailableLink();
        parts.push(chunk);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(body);
}
function abortPromise(signal) {
    return new Promise((_, reject) => {
        if (signal.aborted)
            reject(unavailableLink());
        else
            signal.addEventListener('abort', () => reject(unavailableLink()), { once: true });
    });
}
function createSafePageFetcher({ lookup = defaultLookup, request = defaultRequest, } = {}) {
    return async (input) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), exports.TOTAL_TIMEOUT_MS);
        const operation = async () => {
            let current = parseAllowedUrl(input);
            for (let redirects = 0;; redirects += 1) {
                const target = await resolveAllowedUrl(current, lookup, controller.signal);
                if (controller.signal.aborted)
                    throw unavailableLink();
                const response = await request(target, controller.signal);
                if (response.status >= 300 && response.status < 400) {
                    await readLimitedBody(response, controller.signal);
                    const location = header(response.headers, 'location');
                    if (!location || redirects >= exports.MAX_REDIRECTS)
                        throw unavailableLink();
                    current = parseAllowedUrl(new URL(location, current));
                    continue;
                }
                if (response.status < 200 || response.status >= 300)
                    throw unavailableLink();
                return { url: current.href, body: await readLimitedBody(response, controller.signal) };
            }
        };
        try {
            return await Promise.race([operation(), abortPromise(controller.signal)]);
        }
        catch (error) {
            if (error instanceof LinkImportError)
                throw error;
            throw unavailableLink();
        }
        finally {
            clearTimeout(timer);
            controller.abort();
        }
    };
}
exports.fetchAllowedPage = createSafePageFetcher();
