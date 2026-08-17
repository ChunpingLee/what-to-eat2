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
            const outcomes = await Promise.all(poiIds.map(async (poiId) => {
                try {
                    await favorites.add({ data: { _id: favoriteDocumentId(openid, poiId), poiId, _openid: openid } });
                    return { poiId, status: 'created' };
                }
                catch (error) {
                    if (isDuplicateWrite(error))
                        return { poiId, status: 'existing' };
                    throw error;
                }
            }));
            return {
                created: outcomes.filter(outcome => outcome.status === 'created').map(outcome => outcome.poiId),
                existing: outcomes.filter(outcome => outcome.status === 'existing').map(outcome => outcome.poiId),
            };
        },
        async remove(openid, poiId) {
            await favorites.where({ _openid: openid, poiId }).remove();
        },
    };
}
