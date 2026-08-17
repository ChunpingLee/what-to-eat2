"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountDeletingError = void 0;
exports.accountDocumentId = accountDocumentId;
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
async function ensureAccountWritable(transaction, openid, updatedAt) {
    const id = accountDocumentId(openid);
    const document = transaction.collection('users').doc(id);
    const result = await document.get();
    const state = result.data[0];
    if (state?.status === 'deleting')
        throw new AccountDeletingError();
    if (!state) {
        await document.set({ data: { _id: id, _openid: openid, status: 'active', updatedAt } });
    }
}
