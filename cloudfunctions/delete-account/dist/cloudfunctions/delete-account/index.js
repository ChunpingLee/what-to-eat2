"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteAccountPartialFailure = exports.PERSONAL_DATA_COLLECTIONS = exports.PERSONAL_COLLECTIONS = void 0;
exports.createCloudBaseDeleteRepository = createCloudBaseDeleteRepository;
exports.createDeleteHandler = createDeleteHandler;
exports.main = main;
const account_state_1 = require("../shared/account-state");
const cloudbase_sdk_1 = require("../shared/cloudbase-sdk");
exports.PERSONAL_COLLECTIONS = [
    'favorites',
    'imports',
    'recommendation_events',
    'users',
];
exports.PERSONAL_DATA_COLLECTIONS = ['favorites', 'imports', 'recommendation_events'];
class DeleteAccountPartialFailure extends Error {
    collection;
    failedIds;
    code = 'DELETE_ACCOUNT_PARTIAL_FAILURE';
    constructor(collection, failedIds) {
        super('DELETE_ACCOUNT_PARTIAL_FAILURE');
        this.collection = collection;
        this.failedIds = failedIds;
        this.name = 'DeleteAccountPartialFailure';
    }
}
exports.DeleteAccountPartialFailure = DeleteAccountPartialFailure;
async function inBatches(values, concurrency, task) {
    const failures = [];
    for (let offset = 0; offset < values.length; offset += concurrency) {
        const batch = values.slice(offset, offset + concurrency);
        const results = await Promise.allSettled(batch.map(task));
        results.forEach((result, index) => {
            if (result.status === 'rejected')
                failures.push(batch[index]);
        });
    }
    return failures;
}
/**
 * Deletes stable document IDs page by page. Completed removals stay removed, so retrying
 * after DeleteAccountPartialFailure resumes from the remaining owner-scoped documents.
 */
function createCloudBaseDeleteRepository(database, options = {}) {
    const pageSize = options.pageSize ?? 100;
    const deleteConcurrency = options.deleteConcurrency ?? 20;
    const now = options.now ?? (() => new Date());
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new Error('INVALID_DELETE_PAGE_SIZE');
    if (!Number.isInteger(deleteConcurrency) || deleteConcurrency < 1)
        throw new Error('INVALID_DELETE_CONCURRENCY');
    return {
        async beginDeletion(openid) {
            await database.runTransaction(async (transaction) => {
                const id = (0, account_state_1.accountDocumentId)(openid);
                const account = transaction.collection('users').doc(id);
                const result = await account.get();
                const state = (0, account_state_1.accountStateFromDocumentData)(result.data);
                if (state?.status === 'deleting')
                    return;
                await account.set({
                    _openid: openid, status: 'deleting', updatedAt: now().toISOString(),
                });
            });
        },
        async deleteOwned(openid, collections) {
            const deleted = {};
            for (const name of collections) {
                let count = 0;
                const collection = database.collection(name);
                while (true) {
                    const result = await collection.where({ _openid: openid }).limit(pageSize).get();
                    if (result.data.length === 0)
                        break;
                    const ids = result.data.map(record => record._id).filter(id => typeof id === 'string' && id.length > 0);
                    if (ids.length !== result.data.length)
                        throw new DeleteAccountPartialFailure(name, ids);
                    const failedIds = await inBatches(ids, deleteConcurrency, id => collection.doc(id).remove());
                    count += ids.length - failedIds.length;
                    if (failedIds.length)
                        throw new DeleteAccountPartialFailure(name, failedIds);
                }
                deleted[name] = count;
            }
            return { deleted };
        },
        async finishDeletion(openid) {
            return database.runTransaction(async (transaction) => {
                const account = transaction.collection('users').doc((0, account_state_1.accountDocumentId)(openid));
                const result = await account.get();
                const state = (0, account_state_1.accountStateFromDocumentData)(result.data);
                if (!state)
                    return 0;
                if (state.status !== 'deleting')
                    throw new Error('ACCOUNT_DELETE_STATE_CHANGED');
                await account.remove();
                return 1;
            });
        },
    };
}
function createDeleteHandler(deps) {
    return async (_event) => {
        const openid = deps.getOpenId();
        if (!openid)
            throw new Error('UNAUTHENTICATED');
        await deps.repo.beginDeletion(openid);
        const result = await deps.repo.deleteOwned(openid, exports.PERSONAL_DATA_COLLECTIONS);
        const users = await deps.repo.finishDeletion(openid);
        return { deleted: { ...result.deleted, users } };
    };
}
function main(event, context, injected) {
    const sdk = (0, cloudbase_sdk_1.selectCloudBaseSdk)(injected);
    const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
    return createDeleteHandler({
        getOpenId: () => (0, cloudbase_sdk_1.wxContextFromEnv)().OPENID ?? sdk.getCloudbaseContext(context).OPENID,
        repo: createCloudBaseDeleteRepository(app.database()),
    })(event);
}
