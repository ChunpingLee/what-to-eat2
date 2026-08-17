"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIXED_RESTAURANT_CATEGORIES = void 0;
exports.findRestaurantCategory = findRestaurantCategory;
exports.restaurantCategoryAliases = restaurantCategoryAliases;
exports.FIXED_RESTAURANT_CATEGORIES = [
    { id: 'hotpot', label: '火锅', searchKeyword: '火锅', aliases: ['火锅', '火锅店', '涮锅', '潮汕牛肉火锅'] },
    { id: 'barbecue', label: '烧烤', searchKeyword: '烧烤', aliases: ['烧烤', '烤肉', '烤串', '炭火烤肉'] },
    { id: 'sichuan', label: '川菜', searchKeyword: '川菜', aliases: ['川菜', '四川菜', '四川料理'] },
    { id: 'japanese', label: '日料', searchKeyword: '日本料理', aliases: ['日料', '日本料理', '寿司', '刺身', '居酒屋'] },
    { id: 'coffee', label: '咖啡', searchKeyword: '咖啡', aliases: ['咖啡', '咖啡厅', '咖啡馆', 'cafe'] },
];
const normalize = (value) => value.trim().toLocaleLowerCase('zh-CN');
function findRestaurantCategory(value) {
    if (!value?.trim())
        return undefined;
    const target = normalize(value);
    return exports.FIXED_RESTAURANT_CATEGORIES.find(category => normalize(category.id) === target || normalize(category.label) === target);
}
function restaurantCategoryAliases(value) {
    const category = findRestaurantCategory(value);
    return category?.aliases ?? (value?.trim() ? [value.trim()] : []);
}
