"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDianpingPage = parseDianpingPage;
const shared_1 = require("./shared");
function parseDianpingPage(html) {
    return (0, shared_1.extractPlaceHint)(html);
}
