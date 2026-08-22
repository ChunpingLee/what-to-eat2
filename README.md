# 最想吃啥（微信小程序）

一款「个人想吃清单 + 附近推荐」微信小程序。用户授权定位后，首页按由近到远展示附近的个人收藏餐馆；附近没有收藏、或用户主动切换时，可按品类、关键词、预算、半径和出行时间获取带透明推荐理由的附近推荐。

门店数据全部来自高德 Web 服务 API，用户通过分享链接导入或站内搜索建立自己的清单。不读取美团/大众点评账号收藏，不抓取任何非公开榜单。

## 功能特性

- **收藏优先首页**：附近收藏严格按距离升序排列；支持 1/3/5/10 公里半径筛选（默认 5 公里）。
- **出行方式与时间**：步行、骑行、驾车三种方式，按路线时间过滤收藏与推荐。
- **站内搜索收藏**：按门店名称或任意餐饮关键词搜索；同名多分店可单选或多选批量收藏，重复收藏自动去重并逐项反馈。
- **分享链接导入**：粘贴美团、大众点评、高德的门店分享链接，云端解析并匹配高德 POI；唯一匹配进入单店确认，多分店进入多选，匹配不确定降级到搜索，无法识别允许手动输入。
- **附近推荐**：先按硬条件（品类/关键词、预算、营业状态）筛候选，再对靠前候选计算路线时间；返回 3–10 家门店，每条附来自实际打分信号的推荐理由。
- **单店分享**：分享卡片只携带 `v=1` 和 `poiId`，不暴露分享者身份、备注或完整清单；好友打开后需主动点击才写入自己的收藏。
- **账号注销**：设置页发起，二次确认后以事务锁 + 分页删除方式清除该用户全部个人数据，公共门店数据和其他账号不受影响。

## 技术栈

- **客户端**：微信原生小程序（TypeScript），地图与定位使用微信内置能力
- **后端**：微信云开发 CloudBase 云函数（Node.js 16 运行时，`@cloudbase/node-sdk` 3.x）
- **数据源**：高德 Web 服务 API（关键字搜索、周边搜索、步行/骑行/驾车路线规划）
- **测试**：Vitest

## 目录结构

```
miniprogram/            小程序客户端
  pages/                home（收藏首页）、import（链接导入）、place-search（搜索门店）、
                        recommend（附近推荐）、place-detail（门店详情）、settings（设置）
  components/           branch-picker 多分店勾选组件
  services/             云函数调用封装（cloud.ts）、定位与手选地点（location.ts）
  shared/               客户端侧共享类型与工具
cloudfunctions/         云函数，每个目录是独立 npm 包（index.ts 源码，index.js 构建产物）
  shared/               跨函数共享：CloudBase SDK 形状校验、Node 16 HTTPS JSON 客户端等
src/                    客户端与云函数共用的领域模型（推荐打分、理由生成、收藏、分享、地理）
cloudbase/              数据库安全规则（database.rules.json）与部署脚本（deploy-rules.js）
tests/                  Vitest 测试：cloudfunctions/、miniprogram/、cloudbase/
docs/                   设计规格、发布验收清单、隐私数据台账
```

## 云函数

| 函数 | 职责 | 环境变量 | 建议超时 |
| --- | --- | --- | --- |
| `favorites` | 当前用户收藏的读取、批量新增（去重）和删除 | — | 10 秒 |
| `place-search` | 高德关键字/周边搜索适配，写 `place_search_cache` 与公共 `places` | `AMAP_WEB_KEY` | 15 秒 |
| `place-routes` | 批量路线时间计算，基于事务的 QPS 限流 | `AMAP_WEB_KEY`、`AMAP_ROUTE_QPS` | 15 秒 |
| `link-import` | 分享链接域名白名单校验、安全解析、POI 匹配 | `AMAP_WEB_KEY` | 15 秒 |
| `recommend` | 候选生成、缺失字段归一化打分、推荐理由生成 | `AMAP_WEB_KEY`、`AMAP_ROUTE_QPS` | 20 秒 |
| `share-place` | 按 `poiId` 从公共 `places` 读取分享详情（仅公开字段） | — | 10 秒 |
| `delete-account` | 账号注销：事务锁 + 分页删除个人数据 | — | 30 秒 |

## 数据库集合

| 集合 | 用途 | 客户端权限 |
| --- | --- | --- |
| `users` | 用户状态与偏好 | 仅创建者可读，不可直写 |
| `favorites` | 收藏（`_openid` + `poiId` 唯一） | 仅创建者可读，不可直写 |
| `imports` | 链接导入状态与候选 | 仅创建者可读，不可直写 |
| `recommendation_events` | 推荐反馈（仅个人推荐使用） | 仅创建者可读，不可直写 |
| `places` | 高德 POI 公共缓存（确定性文档 ID = sha256(poiId)） | 所有人可读，不可直写 |
| `place_search_cache` | 搜索缓存 | 客户端不可读写 |
| `amap_route_rate_limits` | 路线限流时间槽 | 客户端不可读写 |

所有写入均通过云函数完成；数据库规则由 `cloudbase/database.rules.json` 统一定义。

## 快速开始

### 前置要求

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- 一个已开通云开发的微信小程序 AppID
- 高德开放平台 Web 服务 Key
- Node.js（本地跑测试与构建用）

### 安装与配置

1. 安装根目录依赖：

   ```bash
   npm install
   ```

2. 用微信开发者工具导入项目根目录的 `project.config.json`。

3. 开通云开发并创建环境，把环境 ID 填入 `miniprogram/app.ts` 的 `cloudEnvironment`。

4. 为 `place-search`、`place-routes`、`link-import`、`recommend` 配置环境变量（云开发控制台 → 云函数 → 配置）：
   - `AMAP_WEB_KEY`：高德 Web 服务 Key，只放云端，不写入源码
   - `AMAP_ROUTE_QPS`：路线 API 限流值（`place-routes`、`recommend`），不高于 Key 实际配额，示例 `3`

### 部署数据库规则

规则下发使用 `@cloudbase/manager-node` 管理端凭证（脚本会先创建缺失集合再下发规则，可重复执行）：

```bash
TCB_ENV_ID=<环境ID> TENCENTCLOUD_SECRETID=<id> TENCENTCLOUD_SECRETKEY=<key> npm run rules:deploy
```

### 部署云函数

在微信开发者工具中，对 `cloudfunctions/` 下每个函数目录右键选择「上传并部署：云端安装依赖（不包含 node_modules）」。

### 创建数据库索引

在云开发控制台为以下字段创建索引（详见 `todo.md` 第 12 节）：

- `favorites`：`_openid` + `poiId` 复合唯一索引
- `imports`、`recommendation_events`、`users`：`_openid`
- `places`：`poiId`

## 本地开发与测试

```bash
npm test                                      # 运行全部 Vitest 测试
npm run test:watch                            # 监听模式
npm run typecheck                             # TypeScript 类型检查
npm run build --prefix cloudfunctions/<name>  # 构建单个云函数（tsc 产出 index.js）
```

测试覆盖：云函数逻辑与权限隔离（`tests/cloudfunctions/`）、页面与控制器契约（`tests/miniprogram/`）、数据库规则与部署脚本（`tests/cloudbase/`）。

## 安全与隐私设计

- **身份可信**：用户身份一律取自云函数运行时的微信调用上下文（`WX_CONTEXT_KEYS`），客户端传入的任何 OpenID/owner 参数均被忽略或拒绝。
- **数据隔离**：个人集合仅创建者可读且客户端不可直写；跨账号无任何可复现的越权路径。
- **密钥不出云端**：高德 Key 仅存于云函数环境变量；客户端不直连高德，只调用云函数。
- **链接解析防护**：仅允许 HTTPS 白名单域名，限制重定向次数、响应大小与超时，防 SSRF。
- **最小化分享**：分享路径仅 `v=1` + `poiId`，从公共 POI 重查详情，不含身份、备注或清单。
- **位置用途受限**：位置仅用于当次附近查询与路线计算，不保存轨迹。
- **数据展示诚实**：评分/人均/营业状态缺失时隐藏字段并重新归一化推荐权重；缓存数据标注更新时间，不冒充实时结果。

## 已知部署注意事项

- 云函数运行时为 Node.js 16（无全局 `fetch`），HTTPS 调用统一走 `cloudfunctions/shared/https-json.ts`。
- SCF 运行时可能给入口函数传入第三参 callback，覆盖 SDK 默认参数并导致 `sdk.init is not a function`；`cloudfunctions/shared/cloudbase-sdk.ts` 对参数做形状校验并回落到 `require('@cloudbase/node-sdk')`。
- `@cloudbase/node-sdk` 必须使用 3.x（4.x 是浏览器 js-sdk 包装，与 server API 不兼容），共享模块会在加载时显式报错。

## 相关文档

- [设计规格](docs/superpowers/specs/2026-08-17-nearby-food-mini-program-design.md) — 产品目标、推荐规则、架构与验收标准
- [实施计划](docs/superpowers/plans/2026-08-17-nearby-food-mini-program.md)
- [发布验收清单](docs/release-checklist.md) — 发布门禁，含生产环境实测项
- [部署与发布任务清单](todo.md) — 当前迭代的逐步操作清单
- [隐私数据台账](docs/privacy-data-inventory.json)
