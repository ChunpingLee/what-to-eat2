"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
exports.createFavoritesHandler = createFavoritesHandler;
const favorites_1 = require("../../src/domain/favorites");
const repository_1 = require("./repository");
function createFavoritesHandler(deps) {
    return async (event) => {
        const openid = deps.getOpenId();
        if (!openid)
            throw new Error('UNAUTHENTICATED');
        if (event.action === 'list')
            return { items: await deps.repo.list(openid) };
        if (event.action === 'remove') {
            await deps.repo.remove(openid, event.poiId);
            return { removed: event.poiId };
        }
        const existingSet = await deps.repo.findExisting(openid, event.poiIds);
        const plan = (0, favorites_1.planFavoriteBatch)(event.poiIds, existingSet);
        const inserted = await deps.repo.insert(openid, plan.toCreate);
        return {
            created: inserted.created,
            existing: [...plan.existing, ...inserted.existing],
            duplicateSelections: plan.duplicateSelections,
        };
    };
}
const main = (event) => {
    const cloudbase = require('@cloudbase/node-sdk');
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const database = app.database();
    const handler = createFavoritesHandler({
        getOpenId: () => cloudbase.getWXContext().OPENID,
        repo: (0, repository_1.createCloudBaseFavoritesRepository)(database, poiIds => database.command.in(poiIds)),
    });
    return handler(event);
};
exports.main = main;
