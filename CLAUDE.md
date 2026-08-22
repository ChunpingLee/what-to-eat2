# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

“最想吃啥” — a WeChat Mini Program (native, TypeScript) + WeChat CloudBase cloud functions + AMap (高德) Web 服务 API. Personal restaurant favorites ranked by distance plus nearby recommendations with transparent scoring reasons. All user data is strictly isolated per WeChat OpenID; the product never reads third-party account data or scrapes rankings. UI text and docs are Chinese; commit messages are English conventional style (`feat:`, `fix:`).

## Commands

```bash
npm test                                          # all Vitest tests (node env, tests/**)
npx vitest run tests/cloudfunctions/link-import.test.ts   # single test file
npm run test:watch
npm run typecheck                                 # tsc --noEmit over src/, cloudfunctions/, miniprogram/, tests/
npm run build --prefix cloudfunctions/<name>      # build one cloud function (tsc -> dist)
TCB_ENV_ID=<env> TENCENTCLOUD_SECRETID=<id> TENCENTCLOUD_SECRETKEY=<key> npm run rules:deploy
                                                  # create missing collections + push database rules (idempotent)
```

Cloud functions themselves can only be deployed through WeChat DevTools (right-click function dir → 上传并部署：云端安装依赖). AMap credentials live in per-function env vars configured in the CloudBase console (`AMAP_WEB_KEY` for place-search/link-import/recommend; `AMAP_ROUTE_QPS` for place-routes/recommend) — they must never appear in source, dist, or the mini program package.

## Architecture

Three compilation units in one repo:

- **`miniprogram/`** — client. WeChat DevTools compiles TS directly (`useCompilerPlugins: ["typescript"]`), no client build step. Each page splits into `index.ts` (wx lifecycle glue) + `controller.ts` (pure logic returning state objects with injected API deps — this is what unit tests exercise). Runtime helpers live in `miniprogram/shared/`; `services/cloud.ts` wraps every `wx.cloud.callFunction` call.
- **`src/`** — shared domain logic (recommendation scoring and reason generation, favorites, geo, share paths). Cloud functions compile it into their own dist; the client imports it **type-only** (see `services/cloud.ts`) — there is no runtime dependency from the client into `src/`. Client runtime code that looks duplicated in `miniprogram/shared/` is intentional.
- **`cloudfunctions/<name>/`** — 7 independent npm packages (favorites, place-search, place-routes, link-import, recommend, share-place, delete-account). Each tsconfig sets `rootDir: "../.."` and `outDir: "dist"`, so tsc emits to `dist/cloudfunctions/<name>/…` mirroring repo paths — this is what lets functions import siblings (`../place-search/amap-client`) and `../../src/domain/*` at runtime. The committed root `index.js` is a one-line shim: `module.exports = require('./dist/cloudfunctions/<name>/index.js')`. `cloudfunctions/shared/` holds cross-function runtime helpers.

Key data flow: the client never sends user identity; every cloud function derives OpenID from the SCF runtime env (`wxContextFromEnv` reading `WX_CONTEXT_KEYS`, in `cloudfunctions/shared/cloudbase-sdk.ts`) and ignores/rejects client-passed identity. Database rules (`cloudbase/database.rules.json`) deny **all** client writes — personal collections are owner-read-only, `places` is public-read, cache/limiter collections are fully locked. All writes go through cloud functions. `places` documents use deterministic `_id = sha256(poiId)`, written by `place-search` and read by `share-place`/`link-import`/`recommend` — share details resolve entirely from this public cache.

### CloudBase runtime constraints (SCF, Node 16)

- No global `fetch` — use `cloudfunctions/shared/https-json.ts` for outbound HTTPS.
- `@cloudbase/node-sdk` is pinned to 3.x; 4.x wraps the browser js-sdk and is server-incompatible — `resolveCloudBaseSdk` fails loudly if loaded.
- The SCF runtime may pass a legacy callback as the **third** handler argument, silently replacing an SDK default parameter (fails later as `sdk.init is not a function`). Entry points must be `main(event, context, injected)` and route `injected` through `selectCloudBaseSdk`.

## Product invariants (enforced by tests and the design spec)

The authoritative spec is `docs/superpowers/specs/2026-08-17-nearby-food-mini-program-design.md`. Points most likely to break by accident:

- Recommendation weights are fixed (category 35% / distance-time 30% / rating 20% / budget 10% / completeness 5%); any missing field removes its dimension and renormalizes the rest. Reasons must only cite signals that actually participated in scoring; never display inferred or missing data.
- Favorites home sorts strictly by distance ascending — no quality score.
- Share payloads carry only `v=1` + `poiId` — no OpenID, owner, notes, or list contents.
- Link parsing allows only HTTPS whitelist domains with bounded redirects/response size/timeouts (anti-SSRF, `url-policy.ts`); Meituan/Dianping pages block server fetches, so pasted share text with a bracketed shop name matches POIs directly and degrades to search → manual input.
- Account deletion uses a transaction lock on the user doc plus paged deletion; it must never touch `places` or other users' data. `tests/cloudfunctions/privacy.test.ts` guards these invariants — keep it passing when touching favorites, share-place, recommend, or delete-account.

## Reference docs

- `docs/superpowers/specs/2026-08-17-nearby-food-mini-program-design.md` — product scope, scoring, degradation rules (authoritative)
- `docs/release-checklist.md` — release gate incl. secret-scan requirements
- `todo.md` — current deployment/release task list
