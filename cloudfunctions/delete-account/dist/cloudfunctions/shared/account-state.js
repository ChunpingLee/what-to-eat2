"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountDeletingError = void 0;
exports.accountDocumentId = accountDocumentId;
exports.accountStateFromDocumentData = accountStateFromDocumentData;
exports.ensureAccountWritable = ensureAccountWritable;
const node_crypto_1 = require("node:crypto");
class AccountDeletingError extends Error {
    code = 'ACCOUNT_DELETING';
    constructor() {
        super('ACCOUNT_DELETING');
        this.name = 'AccountDeletingError';
    }
}
exports.AccountDeletingError = AccountDeletingError;
function accountDocumentId(openid) {
    return (0, node_crypto_1.createHash)('sha256').update(openid).digest('hex');
}
function accountStateFromDocumentData(data) {
    const first = Array.isArray(data) ? data[0] : data;
    if (typeof first !== 'object' || first === null || Array.isArray(first))
        return undefined;
    const record = first;
    if (typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)) {
        return record.data;
    }
    return record;
}
async function ensureAccountWritable(transaction, openid, updatedAt) {
    const id = accountDocumentId(openid);
    const document = transaction.collection('users').doc(id);
    const result = await document.get();
    const state = accountStateFromDocumentData(result.data);
    if (state?.status === 'deleting')
        throw new AccountDeletingError();
    if (!state) {
        await document.set({ _openid: openid, status: 'active', updatedAt });
    }
}
