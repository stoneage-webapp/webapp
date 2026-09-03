# architecture — 구조와 API 명세

## 전체 구조 (TO-BE)

```
Front (Netlify)  ──JSON──▶  Back (Apps Script)  ──▶  DB (Google Sheet / Drive / Photos)
정적 HTML/CSS/JS            JSON API 서버              실제 데이터
PWA 아이콘/manifest         투표/PIN/사진/정산 로직
```

- **통신 방향**: Front는 절대 Sheet에 직접 접근하지 않는다. 항상 `Front → Back → DB`.
  Back(Apps Script)이 PIN 검증 등 문지기 역할을 한다.
- **인증**: 개인 PIN 로그인 → 서버가 서명 토큰 발급 → 이후 쓰기 요청과 민감한 조회에 `name + token` 검증
  (`auth.gs`의 `verify_`). PIN이 바뀌면 기존 토큰은 자동 무효.

## 백엔드 파일 구성 (`apps-script/src/`)

| 파일 | 역할 |
|---|---|
| `Code.gs` | 웹앱 진입점 `doGet`/`doPost` + **action 레지스트리**(auth/bust/cache 플래그) + 조회 캐시 + `getInitData`(+`recent`) + 예기치 못한 오류 로깅(`logError_`→`오류로그` 시트) |
| `config.gs` | 전역 상수 `CONFIG` (실제 값은 커밋 금지 — `v3.0.2/Code.local.md` 참고) |
| `auth.gs` | PIN 로그인, 서명 토큰, 요청 검증, 관리자 판별, PIN 초기화 |
| `members.gs` | 부족원 명단 관리(관리자) — 추가/이름수정/삭제. 부족원 시트 A열만 조작 |
| `budget.gs` | 부족 예산 — 정산 적립(자동)·사용 이력. `예산` 시트. 정산 담당자/관리자 전용 |
| `push.gs` | 푸시 알림(OneSignal) — 공지/번개 즉시 발송, D-1·번개 인증 시간 트리거 |
| `votes.gs` | 정기공격 고정 일정(관리자 지정, 투표 없음) · 자연재해(번개) 투표 · 참석확정(RSVP) · 완료 처리 |
| `opensessions.gs` | 정기 오픈 세션(특정 날짜+장소) — 개설/수정/삭제, 개설 가능 직책 설정(관리자). `오픈세션` 시트에 저장 |
| `photos.gs` | Drive 업로드(청크), Photos 업로드, 벽화 갤러리, 사진 삭제 |
| `hall.gs` | 명예의전당 출품/투표/영상 삭제 |
| `settle.gs` | 월별 인증 정산(시트 메뉴/웹), 월 파싱, 인증현황 집계(열=월 누적)·정산 취소·출석 통계(`getStats`), 부족원 오름차순 정렬(`sortNames_`) |
| `notices.gs` | 공지사항 — 목록/등록/삭제 (관리자). '공지' 시트 자동 생성 |

> Notion API 연동(`notion.gs`)은 2026-07 사용자 결정으로 **완전 제거됨** (#7). 안내문 링크(`NOTION_URL`)는 단순 링크라 유지.

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

### 조회 (GET) — 전부 CacheService 캐싱(2분, 쓰기 시 즉시 무효화)

| action | params | 반환(data) |
|---|---|---|
| `getInitData` | — | `{ members, support, months, raidSchedule, disaster, certified, month, shareUrl, notionUrl, openchatUrl, confirmed, admins, settlers, notices, flashOwners, openSessions, openSessionRoles, flashRoles, raidLocations }` |
| `getVotes` | `month`(선택, `'2026-07'`) | `{ months, raidSchedule, disaster, confirmed, flashOwners }` — month 지정 시 해당 월만 |
| `getGallery` | `limit`(기본12), `offset`(기본0), `month`(선택), `person`(선택) | `{ items:[{when,actDate,loc,people,by,fileId,link}], hasMore }` — 필터 후 페이징 |
| `getHallData` | — | `{ ym, entries:[...], winner, winnerMonth }` |
| `getHallArchive` | — | `{ winners:[...] }` — 월별 최다득표, 최신순, 이번 달 제외 |
| `getSettleStatus` | `ym`(선택, 기본 이번 달) | `{ ym, months:[존재하는 월들], rows:[{name,status}] }` — 인증현황 시트, 지정한 월 한 열만 |
| `getVenueStats` | — | `{ total:[{loc,count}], thisMonth:[{loc,count}], month }` — 암장별 방문 집계 |
| `getCompletionLog` | `limit`(기본10) | `{ items:[{when,kind,month,date,loc,people,by}] }` — `완료기록` 시트 최신순. 정기공격 무산 종료는 `date`가 `'(모임 없음)'` |
| `getOpenSessions` | — | `{ items:[{id,date,loc,note,createdBy,createdAt,voters,dateInfo}], roles:[개설 가능 직책] }` — `date`는 특정 날짜('yyyy-MM-dd', 반복 아님) |

> - `driveApiKey`는 익명 `getInitData`에서 **제거됨** → `loginWithPin`/`changePin` 응답으로 이동.
> - `certNudge`도 같은 이유로 로그인 응답 전용: "이번 달 완료 처리된 모임에 참여했는데 아직 인증 안 함" 여부를 **본인 것만** 알려준다 (`needsCertNudge_`, votes.gs). 다른 사람의 인증 여부를 노출하지 않기 위해 `getInitData` 등 익명 GET에는 포함하지 않는다.
> - **부족원 목록은 항상 이름 오름차순**(`sortNames_`, settle.gs) — `members`, `getStats.members`, `getSettleStatus.rows` 등 목록을 반환하는 모든 곳에 일괄 적용.
> - `getInitData.notices`는 최신 공지 3건(홈 화면 노출용). 전체 목록은 관리자가 인증된 `getNotices` POST로만 조회한다.
> - 투표 항목에는 `dateInfo` 필드가 붙는다:
>   `{ iso:'2026-07-16', ym:'2026-07', weekday:'목', time:'20:00'|null, display:'2026-07-16 (목) 20:00' }`
>   파싱 실패 시 `null` — 프론트는 원본 `date` 라벨로 폴백. 표기는 `dateInfo.display` 우선.
> - 번개(`disaster[]`)는 `loc`(번개 위치) 필드를 가진다. 자연재해 시트의 `위치` 열은 `ensureLocationColumns_`(votes.gs)가
>   배포 후 첫 접근 시 1회 자동 삽입한다(sheets.md 참고).
> - `raidSchedule[]`(정기공격 고정 일정, 더 이상 투표 없음)의 각 항목은 `{ month, date, loc, note, isOverride, dateInfo }`.
>   `isOverride:false`면 기본값(그 달 둘째 주 금요일 20시 + `CONFIG.RAID_LOCATIONS` 로테이션)이 그대로 노출 중이라는 뜻 — 관리자가
>   `setRaidDate`로 지정하면 `isOverride:true`가 된다.

### 인증 조회 / 변경 (POST)

| action | params | 반환(data) |
|---|---|---|
| `loginWithPin` | `name, pin` | `{ name, token, isAdmin, driveApiKey, certNudge, firstSet? }` — 실패 5회 → 10분 잠금 |
| `changePin` | `name, oldPin, newPin, token` | `{ name, token, isAdmin, driveApiKey, certNudge }` |
| `getStats` | `name, token` | `{ months, members:[{name,supported}], cert:{ym:{이름:true}}, votes:{ym:{이름:true}} }` — 관리자는 전체, 일반 회원은 본인 통계만. `votes`는 정기공격 **참석확정(RSVP 'yes')** 집계(정기공격이 고정 일정으로 바뀌며 투표 참여 대신 RSVP로 대체됨) |
| `getNotices` | `limit`(기본20), `name, token` | `{ items:[{when,by,text,row}] }` — 관리자 전용 전체 목록 |
| `toggleVote` | `dateText, voter, token` | `{ date, voters }` — 자연재해(번개) 전용 |
| `addFlash` | `dateText, loc, creator, token` | 자연재해 투표 배열 — `flash_roles`에 포함된 직책(기본 전체=제한 없음) 또는 관리자만 |
| `deleteFlash` | `dateText, requester, token` | 자연재해 투표 배열 |
| `editFlash` | `dateText, newDate, newLoc, requester, token` | 자연재해 투표 배열 — 날짜/위치 라벨만 변경(투표자 유지). 등록자 또는 관리자 |
| `completeFlash` | `dateText, requester, token` | 자연재해 투표 배열 — 완료 처리(등록자 또는 관리자). `완료기록` 시트에 기록 후 목록에서 제거 |
| `setRaidDate` | `month, date, loc, note, requester, token` | `raidSchedule` 배열 — **관리자 전용**. 그 달 정기공격 날짜/장소/설명 지정. `date` 빈 값이면 기본값(둘째 주 금요일+로테이션)으로 복귀 |
| `setRaidLocations` | `locations(배열), requester, token` | `{ locations }` — 관리자 전용. 위치 로테이션 순서 설정(Script Property `raid_locations`). `setAdmins`와 동일하게 **반영은 다음 요청부터** |
| `completeRaid` | `month, requester, token, cancelled?` | `raidSchedule` 배열 — 관리자 전용. `cancelled` 없으면 "완료"(참여자=그 달 RSVP 'yes' 명단), `true`면 "모임 없음"으로 종료. `완료기록` 시트에 기록 후 목록에서 제외 |
| `startUpload` | `fileName, mimeType, fileSize, ym, **name, token**` | Drive resumable 업로드 URL(문자열) |
| `startHallUpload` | `fileName, mimeType, fileSize, **name, token**` | Drive resumable 업로드 URL(문자열) |
| `uploadChunk` | `uploadUrl, b64, start, end, total, **name, token**` | `{ done, fileId? }` |
| `checkUploadStatus` | `uploadUrl, total, **name, token**` | `{ done, fileId?, code? }` |
| `finalizeProof` | `fileId, meta, token` | `{ link, photos }` |
| `finalizeHallEntry` | `fileId, title, uploader, token` | `getHallData()` 결과 |
| `deleteProof` | `fileId, requester, token` | `{ ok:true }` |
| `deleteHallEntry` | `fileId, requester, token` | `getHallData()` 결과 |
| `voteHall` | `fileId, voter, token` | `getHallData()` 결과 |
| `resetPin` | `targetName, requester, token` | `{ name, reset:true }` — 관리자 전용. 대상자는 다음 로그인에서 새 PIN 설정 |
| `addMember` | `newName, requester, token` | `{ members, support, settlers }` — 관리자 전용. 부족원 시트 A열에 이름 추가 |
| `renameMember` | `oldName, newName, requester, token` | `{ members, support, settlers }` — 관리자 전용. A열 이름만 변경(PIN·지원여부 유지). 관리자 이름은 불가 |
| `deleteMember` | `targetName, requester, token` | `{ members, support, settlers }` — 관리자 전용. 행 전체 삭제. 관리자 이름은 불가 |
| `setAdmins` | `names(배열), requester, token` | `{ admins }` — 관리자 전용. Script Property `ADMINS` 설정(부관리자). 로스터 이름만, 최소 1명. 반영은 다음 실행부터 |
| `setDormant` | `targetName, until('yyyy-MM-dd' 또는 ''), requester, token` | 멤버 스냅샷 — 관리자 전용. **휴면**(부족원 K열). 최대 3개월, 종료일 경과 시 자동 복귀. 빈 값=즉시 해제 |
| `setRole` | `targetName, role, requester, token` | 멤버 스냅샷 — 관리자 전용. **직책**(부족원 L열): 부족심사중/조약돌/간석기/고인돌/팀장 |
| `addOpenSession` | `dates(배열, 'yyyy-MM-dd'[]), loc, note, requester, token` | `getOpenSessions()` 결과 — 관리자 또는 `open_session_roles`에 포함된 직책(기본 팀장)만 개설. 여러 날짜를 한 번에 같은 장소/설명으로 등록 |
| `editOpenSession` | `id, date, loc, note, requester, token` | `getOpenSessions()` 결과 — 개설자 또는 관리자만 |
| `deleteOpenSession` | `id, requester, token` | `getOpenSessions()` 결과 — 개설자 또는 관리자만 |
| `toggleOpenSessionVote` | `id, voter, token` | `{ id, voters }` — 로그인한 누구나. 개설자는 자동으로 첫 참여자(번개와 동일 관례) |
| `setOpenSessionRoles` | `roles(배열), requester, token` | `getOpenSessions()` 결과 — 관리자 전용. 오픈 세션 개설 가능 직책 설정(Script Property `open_session_roles`) |
| `setFlashRoles` | `roles(배열), requester, token` | `{ roles }` — 관리자 전용. 번개 개설 가능 직책 설정(Script Property `flash_roles`, 기본값=전체) |
| `getBudget` | `name, token` | `{ balance, credit, spent, perPerson, items:[{when,kind,amount,note,by,month,row}] }` — **정산 담당자/관리자만** |
| `addExpense` | `amount, note, name, token` | `getBudget()` 결과 — 예산 사용 등록 (정산 담당자/관리자) |
| `deleteBudgetItem` | `row, when, name, token` | `getBudget()` 결과 — 예산 기록 삭제. `when` 대조 |
| `setRsvp` | `month('2026-08'), status('yes'\|'no'\|''), name, token` | `{ rsvp: {월:{이름:상태}} }` — **본인**. 확정 모임 참석 확정. 빈 값=미정(취소) |
| `postNotice` | `text, name, token` | `{ items(전체), home(고정+최신1) }` — 관리자 전용 |
| `deleteNotice` | `row, when, name, token` | `{ items, home }` — 관리자 전용. `when` 대조로 행 밀림 방지 |
| `editNotice` | `row, when, text, name, token` | `{ items, home }` — 관리자 전용. 공지 내용(C열) 수정. `when` 대조 |
| `pinNotice` | `row, when, pinned(bool), name, token` | `{ items, home }` — 관리자 전용. 공지 시트 **D열(고정)** 설정. 홈은 고정 공지 전부 + 최신 1건만 노출 |
| `runSettle` | `ym('2026-07'), requester, token` | `{ ym, done, total, independent, copied, uncovered }` — **관리자 또는 정산 담당자** |
| `setSettlers` | `names(배열), requester, token` | `{ settlers }` — 관리자 전용. Script Properties `settlers`에 저장 |
| `setSupports` | `names(지원 대상 배열), requester, token` | `{ support: {이름:bool} }` — 관리자 전용. 부족원 시트 **J열(지원여부)** 기록 |
| `cancelSettle` | `ym, targetName, requester, token` | `getSettleStatus(ym)` — 인원별 해당 월 정산 취소/복구 토글 (관리자·담당자) |
| `resetSettle` | `ym, requester, token` | `{ reset:true, ym }` — 해당 월 열만 초기화 (다른 달 기록은 보존) |

> `meta`(finalizeProof) = `{ kind:'사진'|'영상', mimeType, fileSize, participants:[], location, uploader, activityLabel }`

## 프론트 구성 (`frontend/`)

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 마크업 + PWA 메타 (favicon/apple-touch-icon/manifest 절대경로) |
| `js/api.js` | **GAS 호출의 유일한 창구** — `run('액션', 인자...)` 를 fetch 로 변환. exec URL 상수는 이 파일 상단 한 곳 |
| `js/app.js` | 화면 로직 (GAS 시절 코드 이식 + 월필터/D-day/더보기 탭) |
| `js/mock.js` | `?mock=1` 로 열었을 때만 활성화되는 개발용 목데이터 |
| `css/style.css` | 스타일 (기존 테마 이식) |
| `manifest.json` / `icons/` | PWA. 아이콘은 실제 로고(석기시대 마스코트). 원본 `icons/logo-original.png` 보관 |

- 개발 미리보기: `node .claude/preview-server.mjs` → `http://localhost:8787/?mock=1`

## 화면 ↔ action 매핑

| 화면/탭 | 호출 action |
|---|---|
| 초기 로드 | `getInitData` |
| 로그인 | `loginWithPin`, `changePin` |
| 정기공격(고정 일정) | `setRaidDate`(관리자), `setRsvp`(참석확정), `completeRaid`(관리자) |
| 번개(자연재해 투표) | `toggleVote`, `addFlash`, `deleteFlash`, `editFlash`, `completeFlash`. 개설 가능 직책 설정은 관리 탭의 `setFlashRoles`(관리자) |
| 정기 오픈 세션 (날짜+장소, 캘린더에서 여러 날짜 선택해 등록) | `getOpenSessions`, `addOpenSession`/`editOpenSession`/`deleteOpenSession`(개설자·관리자), `toggleOpenSessionVote`(참여의사, 누구나). 개설 가능 직책 설정은 관리 탭의 `setOpenSessionRoles`(관리자) |
| 사진 인증 | `startUpload` → `uploadChunk`/`checkUploadStatus` → `finalizeProof` |
| 벽화 갤러리 | `getGallery`(월/사람 필터), `deleteProof` |
| 명예의전당 | `getHallData`, `getHallArchive`, `startHallUpload` → `finalizeHallEntry`, `voteHall`, `deleteHallEntry` |
| 공지 | 홈: `getInitData.notices`(고정 전부 + 최신 1건, 새 공지 뱃지), 더보기(관리자): `getNotices`, `postNotice`/`editNotice`/`deleteNotice`/`pinNotice` |
| 참석 확정(RSVP) · 번개 인증 리마인더 | 확정 배너 `setRsvp` · 홈 인앱 리마인더(그날 번개 시각 이후) |
| 홈 새 소식 (최근 24h 벽화/전당) · 모임 D-1 리마인더 | `getInitData.recent` · 확정 모임 D-day |
| 홈 이번 주 일정 요약 (정기공격·오픈세션·번개) | 신규 action 없음 — `getInitData`의 `raidSchedule`/`openSessions`/`disaster`를 프론트에서 오늘~+6일로 필터링(`renderWeekSummary`) |
| 통계 | `getStats`(관리자 전체/일반 본인) |
| 완료된 모임 기록 | `getCompletionLog` |
| 관리 탭 (관리자·정산 담당자만 노출) | `runSettle`, `getSettleStatus`, `cancelSettle`, `resetSettle`, `setSettlers`(관리자), `setSupports`(관리자), `resetPin`(관리자), `addMember`/`renameMember`/`deleteMember`(관리자, 부족원 관리) |

## AS-IS와의 차이 (참고)

- 기존 `v3.0.2/`는 `google.script.run`(GAS 네이티브 RPC) + `HtmlService` 템플릿으로 화면을 직접 렌더링했다.
- 현재는 `doGet`이 JSON을 반환하고, 프론트 `js/api.js`의 `run()`이 같은 호출 형태를 fetch 로 재구현했다
  — **화면 코드의 호출부는 GAS 시절과 동일**하고, 백엔드 로직 함수도 그대로 재사용한다.
- 브라우저→Drive 직접 업로드(resumable PUT)와 릴레이 폴백 구조는 변경 없음.
