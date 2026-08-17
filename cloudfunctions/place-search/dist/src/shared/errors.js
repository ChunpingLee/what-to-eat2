"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafeError = void 0;
exports.safePlaceSearchError = safePlaceSearchError;
/** An error whose public code and message are safe to return from a cloud function. */
class SafeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SafeError';
    }
}
exports.SafeError = SafeError;
function safePlaceSearchError(error) {
    if (error instanceof SafeError)
        return error;
    return new SafeError('AMAP_UNAVAILABLE', 'Place search is temporarily unavailable');
}
