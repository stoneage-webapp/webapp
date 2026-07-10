# apps-script — 백엔드 (Apps Script JSON API)

`Front(Netlify) → Back(여기) → DB(Sheet/Drive/Photos)` 구조의 백엔드.
화면은 그리지 않고 **JSON만 반환**한다.

## 구성

| 파일 | 역할 |
|---|---|
| `src/Code.gs` | `doGet`/`doPost` 진입점 + action 라우팅 + `getInitData` + 헬퍼 |
| `src/config.gs` | 전역 상수 `CONFIG` (실제 값은 커밋 금지) |
| `src/auth.gs` | PIN 로그인/토큰/검증 |
| `src/votes.gs` | 투표/번개/확정 |
| `src/photos.gs` | 업로드/갤러리/삭제 |
| `src/hall.gs` | 명예의전당 |
| `src/settle.gs` | 월별 정산 |
| `src/notion.gs` | 노션 기록 (Phase 6에서 제거 예정) |
| `appsscript.json` | 매니페스트 (타임존/스코프/웹앱 접근) |

## 통신 규약 · API 명세

`docs/architecture.md` 참고. 요약:
- GET: `?action=<name>&param=...`
- POST: body `JSON.stringify({action,...})`, `Content-Type: text/plain;charset=utf-8`
- 응답: `{ ok:true, data }` / `{ ok:false, error }`

## 설정값 채우기

`src/config.gs`의 `CONFIG`는 placeholder(`YOUR_...`)로 커밋됨.
실제 값은 `v3.0.2/Code.local.md`(gitignore)에서 복사해 웹에디터/로컬에서만 채운다.

## 배포

`docs/deploy.md` 참고. 핵심: `clasp deploy --deploymentId <기존ID>`로 exec URL 유지.

## 로컬 검증

각 파일 문법은 `node --check <file>`로 확인 가능(GAS 전역 API는 무시됨, 문법만 검증).
배포 후에는 `<execUrl>?action=getInitData`를 브라우저에서 호출해 JSON을 확인한다.
