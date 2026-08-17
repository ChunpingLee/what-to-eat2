"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distanceMeters = distanceMeters;
const EARTH_RADIUS_METERS = 6_371_000;
const radians = (degrees) => degrees * Math.PI / 180;
function distanceMeters(from, to) {
    if (from.latitude === to.latitude && from.longitude === to.longitude)
        return 0;
    const dLat = radians(to.latitude - from.latitude);
    const dLon = radians(to.longitude - from.longitude);
    const lat1 = radians(from.latitude);
    const lat2 = radians(to.latitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
