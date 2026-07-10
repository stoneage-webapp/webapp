# architecture — 구조와 API 명세

## 전체 구조 (TO-BE)

```
Front (Netlify)  ──JSON──▶  Back (Apps Script)  ──▶  DB (Google Sheet / Drive / Photos)
정적 HTML/CSS/JS            JSON API 서버              실제 데이터
PWA 아이콘/manifest         투표/PIN/사진/정산 로직
```

- **통신 방향**: Front는 절대 Sheet에 직접 접근하지 않는다. 항상 `Front → Back → DB`.
  Back(Apps Script)이 PIN 검증 등 문지기 역할을 한다.
- **인증**: 개인 PIN 로그인 → 서버가 서명 토큰 발급 → 이후 쓰기 요청마다 `name + token` 검증
  (`auth.gs`의 `verify_`). PIN이 바뀌면 기존 토큰은 자동 무효.

## 백엔드 파일 구성 (`apps-script/src/`)

| 파일 | 역할 |
|---|---|
| `Code.gs` | 웹앱 진입점 `doGet`/`doPost` + **action 라우팅** + `getInitData` + 공통 헬퍼 |
| `config.gs` | 전역 상수 `CONFIG` (실제 값은 커밋 금지 — `v3.0.2/Code.local.md` 참고) |
| `auth.gs` | PIN 로그인, 서명 토큰, 요청 검증, 관리자 판별 |
| `votes.gs` | 정기공격/자연재해 투표, 번개, 일정 확정, 마감 판정 |
| `photos.gs` | Drive 업로드(청크), Photos 업로드, 벽화 갤러리, 사진 삭제 |
| `hall.gs` | 명예의전당 출품/투표/영상 삭제 |
| `settle.gs` | 월별 인증 정산(시트 메뉴), 월 파싱, 인증현황 집계 |
| `notion.gs` | 정기모임 확정 시 노션 캘린더 기록 — **Phase 6에서 제거 예정** |

> Apps Script는 모든 `.gs`가 전역 스코프를 공유한다. 파일 분리는 순수 정리 목적이며,
> 함수는 어느 파일에 있든 서로 호출 가능하다.

## 통신 규약

- **조회(GET)**: `<execUrl>?action=<name>&<param>=<value>`
- **변경(POST)**: `body = JSON.stringify({ action, ...params })`
  - `Content-Type: text/plain;charset=utf-8` **필수** (CORS 프리플라이트 회피, `application/json` 금지)
  - Back에서 `JSON.parse(e.postData.contents)`로 파싱
- **응답 봉투**: `{ ok: true, data: <결과> }` 또는 `{ ok: false, error: <메시지> }`
  - 기존 로직 함수의 `throw`는 라우터(`_json`)가 `{ ok:false, error }`로 변환

## API 명세

### 조회 (GET)

| action | params | 반환(data) |
|---|---|---|
| `getInitData` | — | `{ members, raidMonths, disaster, certified, month, shareUrl, notionUrl, driveApiKey, confirmed, admins, flashOwners }` |
| `getGallery` | `limit`(기본12), `offset`(기본0) | `{ items:[{when,actDate,loc,people,by,fileId,link}], hasMore }` |
| `getHallData` | — | `{ ym, entries:[...], winner, winnerMonth }` |

### 변경 (POST)

| action | params | 반환(data) |
|---|---|---|
| `loginWithPin` | `name, pin` | `{ name, token, isAdmin, firstSet? }` |
| `changePin` | `name, oldPin, newPin, token` | `{ name, token, isAdmin }` |
| `toggleVote` | `category('raid'\|'disaster'), dateText, voter, token, month` | `{ date, voters }` |
| `addFlash` | `dateText, loc, creator, token` | 자연재해 투표 배열 |
| `deleteFlash` | `dateText, requester, token` | 자연재해 투표 배열 |
| `confirmDate` | `month, dateText, loc, name, pin` | `raidMonths` 배열 (관리자 PIN 검증) |
| `startUpload` | `fileName, mimeType, fileSize, ym` | Drive resumable 업로드 URL(문자열) |
| `startHallUpload` | `fileName, mimeType, fileSize` | Drive resumable 업로드 URL(문자열) |
| `uploadChunk` | `uploadUrl, b64, start, end, total` | `{ done, fileId? }` |
| `checkUploadStatus` | `uploadUrl, total` | `{ done, fileId?, code? }` |
| `finalizeProof` | `fileId, meta, token` | `{ link, photos }` |
| `finalizeHallEntry` | `fileId, title, uploader, token` | `getHallData()` 결과 |
| `deleteProof` | `fileId, requester, token` | `{ ok:true }` |
| `deleteHallEntry` | `fileId, requester, token` | `getHallData()` 결과 |
| `voteHall` | `fileId, voter, token` | `getHallData()` 결과 |

> `meta`(finalizeProof) = `{ kind:'사진'|'영상', mimeType, fileSize, participants:[], location, uploader, activityLabel }`

## 화면 ↔ action 매핑 (프론트 재구축 #6 때 채움)

| 화면/탭 | 호출 action |
|---|---|
| 초기 로드 | `getInitData` |
| 로그인 | `loginWithPin`, `changePin` |
| 투표(정기공격/번개) | `toggleVote`, `addFlash`, `deleteFlash`, `confirmDate` |
| 사진 인증 | `startUpload` → `uploadChunk`/`checkUploadStatus` → `finalizeProof` |
| 벽화 갤러리 | `getGallery`, `deleteProof` |
| 명예의전당 | `getHallData`, `startHallUpload` → `finalizeHallEntry`, `voteHall`, `deleteHallEntry` |

## AS-IS와의 차이 (참고)

- 기존 `v3.0.2/`는 `google.script.run`(GAS 네이티브 RPC) + `HtmlService` 템플릿으로 화면을 직접 렌더링했다.
- 리팩터 후에는 `doGet`이 HTML 대신 JSON을 반환한다. `google.script.run` 호출은 프론트 재구축(#6)에서
  `fetch(execUrl, ...)` 호출로 교체된다. **로직 함수 자체는 그대로 재사용**한다.
