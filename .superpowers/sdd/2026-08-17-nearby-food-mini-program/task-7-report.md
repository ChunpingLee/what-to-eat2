# Task 7 report: safe shared-link import

## Status contract

- `link-import` accepts only HTTPS URLs on `meituan.com`, `dianping.com`, `amap.com`, or their platform-controlled subdomains. URL credentials and non-default ports are rejected.
- Every hop performs fresh DNS resolution, rejects the complete answer set if any address is loopback/private/link-local, and pins the selected public address into the TLS lookup callback. Redirect targets are revalidated, with at most three redirects.
- One five-second deadline covers DNS, connection, redirects, and body reads. Every response, including redirects, is limited to 1 MiB. Requests carry no Cookie and response cookies are neither replayed nor stored.
- Platform adapters inspect only JSON-LD, public metadata, and the document title for minimal `name`, `city`, `address`, and branch clues. They do not attempt login, anti-bot bypass, or page persistence.
- Import results are `matched` for one or more existing `place-search` candidates, `search` when a safe restaurant name remains, and `manual` when no useful name can be extracted. Unsupported or unavailable links expose only fixed public error codes/messages.
- The import page is registered and reachable from Home before location permission. Matched candidates reuse `branch-picker`; search fallback pre-fills the existing place-search page.

## TDD evidence

- RED: `tests/cloudfunctions/link-import.test.ts` initially failed because the link-import handler did not exist.
- GREEN: URL policy, safe fetcher, parser adapters, place-search matching, CloudBase deployment entrypoint, and fallback behavior passed 31 focused tests.
- RED/GREEN follow-ups covered redirect response limits, hexadecimal IPv4-mapped IPv6 SSRF (`::ffff:7f00:1`), import-page registration, and search-query prefill including literal percent signs.

## Verification

- `npm test` — passed: 10 files / 78 tests.
- `npm run typecheck` — passed.
- `npm run build` in `cloudfunctions/link-import`, `cloudfunctions/place-search`, and `cloudfunctions/favorites` — passed.
- `git diff --check` — passed.

## Manual check

This environment does not provide WeChat Developer Tools or authenticated real-platform sessions, so the three-platform paste flow was not manually exercised. The adapters intentionally degrade when public page markup changes or requires login; manual testing remains required before release.
