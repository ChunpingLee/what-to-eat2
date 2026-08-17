"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMeituanPage = parseMeituanPage;
const shared_1 = require("./shared");
function parseMeituanPage(html) {
    return (0, shared_1.extractPlaceHint)(html);
}
