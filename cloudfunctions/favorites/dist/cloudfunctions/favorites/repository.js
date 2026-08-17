"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCloudBaseFavoritesRepository = createCloudBaseFavoritesRepository;
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
            await Promise.all(poiIds.map(poiId => favorites.add({ data: { poiId, _openid: openid } })));
        },
        async remove(openid, poiId) {
            await favorites.where({ _openid: openid, poiId }).remove();
        },
    };
}
