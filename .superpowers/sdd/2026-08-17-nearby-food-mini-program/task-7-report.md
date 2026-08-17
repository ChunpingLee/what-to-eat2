# Task 7 report: safe shared-link import

## Status contract

- `link-import` accepts only HTTPS URLs on the six explicitly supported hosts: `www.meituan.com`, `m.meituan.com`, `www.dianping.com`, `m.dianping.com`, `www.amap.com`, and `ditu.amap.com`. URL credentials, non-default ports, apex domains, and every unlisted subdomain are rejected.
- Every hop performs fresh DNS resolution and rejects the complete answer set unless every result is valid global unicast with a matching address family. The selected address is pinned into a fresh TLS connection and checked against the normalized connected peer. Redirect targets are revalidated, with at most three redirects.
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

## Fix round 1 — exact hosts, global-unicast IPs, and pinned sockets

### RED

- Added explicit allowed/rejected host cases for Meituan, Dianping, and Amap. The suffix policy incorrectly accepted arbitrary and apex platform domains.
- Added an address matrix covering special-use IPv4, IPv4-mapped and translated IPv6, NAT64, 6to4, Teredo, site-local, ULA, loopback, link-local, multicast, documentation, unspecified, reserved, and ordinary global IPv4/IPv6. The prior partial denylist accepted 11 prohibited IPv6 forms.
- Added transport-level tests proving `agent: false`, TLS SNI and certificate verification, fixed lookup output, and rejection of a mismatched connected peer.
- Added a delayed DNS test proving that a lookup completing after the five-second total deadline must not invoke the HTTPS adapter.

### GREEN

- Replaced suffix matching with one exact host-to-parser map for the six fixture-backed hosts.
- Replaced the partial IP denylist with global-unicast classification: IPv4 special-use blocks are excluded; IPv6 must be inside allocated `2000::/3` while special/reserved, documentation, transition, mapped, translated, and embedded forms are rejected. Every DNS result must also have the correct family.
- Each request now sets `agent: false`, pins the validated address through `lookup`, retains the original hostname as TLS `servername`, keeps `rejectUnauthorized: true`, canonicalizes the connected peer address, and rejects any mismatch.
- DNS receives the abort signal and the signal is checked immediately before and after every lookup and again before HTTPS request creation.

### Fix-round verification

- `npm test -- tests/cloudfunctions/link-import.test.ts` — passed: 70 tests.
- `npm test` — passed: 10 files / 117 tests.
- `npm run typecheck` — passed.
- `npm run build` in `cloudfunctions/link-import`, `cloudfunctions/place-search`, and `cloudfunctions/favorites` — passed.
- `git diff --check` — passed.
- Real-platform and WeChat Developer Tools manual verification remains unavailable in this environment.
