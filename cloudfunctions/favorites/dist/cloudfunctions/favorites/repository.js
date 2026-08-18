"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCloudBaseFavoritesRepository = createCloudBaseFavoritesRepository;
const node_crypto_1 = require("node:crypto");
const public_places_1 = require("../shared/public-places");
const account_state_1 = require("../shared/account-state");
function favoriteDocuments(data) {
    const values = Array.isArray(data) ? data : data === undefined || data === null ? [] : [data];
    return values.flatMap(value => {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            return [];
        const record = value;
        const candidate = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
            ? record.data
            : record;
        return [candidate];
    });
}
function favoriteDocumentId(openid, poiId) {
    return (0, node_crypto_1.createHash)('sha256').update(`${openid}\0${poiId}`).digest('hex');
}
function safeErrorCode(error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = error.code;
        if (typeof code === 'string' && /^DATABASE_[A-Z_]+$/.test(code))
            return code;
    }
    return 'DATABASE_WRITE_FAILED';
}
function createCloudBaseFavoritesRepository(database, inQuery = poiIds => ({ $in: poiIds }), now = () => new Date()) {
    const favorites = database.collection('favorites');
    const places = database.collection('places');
    return {
        async list(openid) {
            const result = await favorites.where({ _openid: openid }).get();
            const records = [...result.data].sort((left, right) => {
                const leftCreated = typeof left.createdAt === 'string' ? left.createdAt : '';
                const rightCreated = typeof right.createdAt === 'string' ? right.createdAt : '';
                return leftCreated.localeCompare(rightCreated) || left.poiId.localeCompare(right.poiId);
            });
            const resolved = await Promise.all(records.map(async (record) => {
                const found = await places.doc((0, public_places_1.publicPlaceDocumentId)(record.poiId)).get();
                return { poiId: record.poiId, place: (0, public_places_1.publicPlaceFromDocumentData)(found.data) };
            }));
            return {
                items: resolved.flatMap(item => item.place ? [item.place] : []),
                unresolved: resolved.flatMap(item => item.place ? [] : [item.poiId]),
            };
        },
        async findExisting(openid, poiIds) {
            if (poiIds.length === 0)
                return new Set();
            const result = await favorites.where({ _openid: openid, poiId: inQuery(poiIds) }).get();
            return new Set(result.data.map(record => record.poiId));
        },
        async insert(openid, poiIds) {
            const outcomes = await Promise.allSettled(poiIds.map(poiId => database.runTransaction(async (transaction) => {
                const createdAt = now().toISOString();
                await (0, account_state_1.ensureAccountWritable)(transaction, openid, createdAt);
                const id = favoriteDocumentId(openid, poiId);
                const favorite = transaction.collection('favorites').doc(id);
                const found = await favorite.get();
                if (favoriteDocuments(found.data).some(value => value.poiId === poiId))
                    return { poiId, status: 'existing' };
                await favorite.set({ poiId, _openid: openid, createdAt });
                return { poiId, status: 'created' };
            })));
            const deleting = outcomes.find((outcome) => outcome.status === 'rejected'
                && outcome.reason instanceof account_state_1.AccountDeletingError);
            if (deleting)
                throw deleting.reason;
            for (const outcome of outcomes) {
                if (outcome.status !== 'rejected')
                    continue;
                const reason = outcome.reason;
                console.error({
                    event: 'FAVORITE_INSERT_REJECTED',
                    reasonCode: typeof reason.code === 'string' ? reason.code : undefined,
                    reasonName: typeof reason.name === 'string' ? reason.name : undefined,
                    reasonMessage: typeof reason.message === 'string' ? reason.message.slice(0, 200) : undefined,
                });
            }
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
            await database.runTransaction(async (transaction) => {
                await (0, account_state_1.ensureAccountWritable)(transaction, openid, now().toISOString());
                await transaction.collection('favorites').doc(favoriteDocumentId(openid, poiId)).remove();
            });
        },
    };
}
