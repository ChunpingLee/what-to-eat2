"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAmapPage = parseAmapPage;
const shared_1 = require("./shared");
function parseAmapPage(html) {
    return (0, shared_1.extractPlaceHint)(html);
}
