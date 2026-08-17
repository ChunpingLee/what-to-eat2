"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCloudBaseFavoritesRepository = createCloudBaseFavoritesRepository;
const node_crypto_1 = require("node:crypto");
function favoriteDocumentId(openid, poiId) {
    return (0, node_crypto_1.createHash)('sha256').update(`${openid}\0${poiId}`).digest('hex');
}
function isDuplicateWrite(error) {
    return typeof error === 'object' && error !== null && 'code' in error
        && error.code === 'DATABASE_DUPLICATE_WRITE';
}
function safeErrorCode(error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = error.code;
        if (typeof code === 'string' && /^DATABASE_[A-Z_]+$/.test(code))
            return code;
    }
    return 'DATABASE_WRITE_FAILED';
}
function createCloudBaseFavoritesRepository(database, inQuery = poiIds => ({ $in: poiIds })) {
    const favorites = database.collection('favorites');
    return {
        async list(openid) {
            const result = await favorites.where({ _openid: openid }).get();
            return result.data;
        },
        async findExisting(openid, poiIds) {
            if (poiIds.length === 0)
                return new Set();
            const result = await favorites.where({ _openid: openid, poiId: inQuery(poiIds) }).get();
            return new Set(result.data.map(record => record.poiId));
        },
        async insert(openid, poiIds) {
            const outcomes = await Promise.allSettled(poiIds.map(async (poiId) => {
                try {
                    await favorites.add({ data: { _id: favoriteDocumentId(openid, poiId), poiId, _openid: openid } });
                    return { poiId, status: 'created' };
                }
                catch (error) {
                    if (isDuplicateWrite(error)) {
                        const id = favoriteDocumentId(openid, poiId);
                        const confirmed = await favorites.where({ _id: id, _openid: openid, poiId }).get();
                        if (confirmed.data.some(record => record.poiId === poiId))
                            return { poiId, status: 'existing' };
                    }
                    throw error;
                }
            }));
            const successful = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
            return {
                created: successful.filter(outcome => outcome.status === 'created').map(outcome => outcome.poiId),
                existing: successful.filter(outcome => outcome.status === 'existing').map(outcome => outcome.poiId),
                failed: outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
                    ? [{ poiId: poiIds[index], code: safeErrorCode(outcome.reason) }]
                    : []),
            };
        },
        async remove(openid, poiId) {
            await favorites.where({ _openid: openid, poiId }).remove();
        },
    };
}
