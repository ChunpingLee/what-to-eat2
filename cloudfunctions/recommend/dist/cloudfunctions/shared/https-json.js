"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpsJsonFetch = createHttpsJsonFetch;
const node_https_1 = require("node:https");
const nativeRequester = (url, options, onResponse) => (0, node_https_1.request)(url, options, onResponse);
function createHttpsJsonFetch(requester = nativeRequester) {
    return (input, { signal }) => new Promise((resolve, reject) => {
        const request = requester(input, { method: 'GET', signal }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            response.on('error', reject);
            response.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                resolve({
                    ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
                    async json() { return JSON.parse(body); },
                });
            });
        });
        request.once('error', reject);
        request.end();
    });
}
