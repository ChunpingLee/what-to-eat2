"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendationReasons = recommendationReasons;
const displayNumber = (value) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
function recommendationReasons(signals) {
    return signals.flatMap(signal => {
        if (signal.key === 'preference' && signal.rawScore >= 0.8)
            return [`匹配“${signal.actual}”偏好`];
        if (signal.key === 'distance' && signal.rawScore >= 0.4)
            return [`直线距离 ${displayNumber(Number(signal.actual))} 米`];
        if (signal.key === 'travelTime' && signal.rawScore >= 0.4)
            return [`路线约 ${displayNumber(Number(signal.actual))} 分钟`];
        if (signal.key === 'rating' && signal.rawScore >= 0.8)
            return [`高德评分 ${displayNumber(Number(signal.actual))}`];
        if (signal.key === 'budget' && signal.rawScore === 1)
            return [`人均 ¥${displayNumber(Number(signal.actual))} 符合预算`];
        return [];
    });
}
