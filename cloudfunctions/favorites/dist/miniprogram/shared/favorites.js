"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortNearbyFavorites = sortNearbyFavorites;
exports.planFavoriteBatch = planFavoriteBatch;
const geo_1 = require("./geo");
function sortNearbyFavorites(places, center, radiusMeters) {
    return places
        .map(place => ({ place, distanceMeters: (0, geo_1.distanceMeters)(center, place.location) }))
        .filter(item => item.distanceMeters <= radiusMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters || a.place.poiId.localeCompare(b.place.poiId));
}
function planFavoriteBatch(selected, existing) {
    const seen = new Set();
    const toCreate = [], duplicateSelections = [], existingIds = [];
    for (const poiId of selected) {
        if (seen.has(poiId)) {
            duplicateSelections.push(poiId);
            continue;
        }
        seen.add(poiId);
        if (existing.has(poiId))
            existingIds.push(poiId);
        else
            toCreate.push(poiId);
    }
    return { toCreate, existing: existingIds, duplicateSelections };
}
