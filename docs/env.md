# env — 어떤 값이 어디에 필요한가

> ⚠️ **이 문서에는 실제 값을 적지 않는다.** "무엇이 어디에 필요한지"만 설명한다.
> 실제 값은 `v3.0.2/Code.local.md`(gitignore됨)에 보관하고, 배포 시 해당 위치에 채워 넣는다.

## 백엔드 (`apps-script/src/config.gs`의 `CONFIG`)

| 키 | 설명 | 획득 위치 |
|---|---|---|
| `SPREADSHEET_ID` | 공용 Google Sheet ID | 시트 URL `/d/<ID>/edit` |
| `DRIVE_FOLDER_ID` | 인증 사진/영상 저장 폴더 | Drive 폴더 URL |
| `SETTLE_FOLDER_ID` | 월별 정산 사진 수집 폴더(별도) | Drive 폴더 URL |
| `PHOTOS_ALBUM_ID` | Google Photos 앨범 ID | `setupPhotosAlbum()` 실행 후 로그 |
| `PHOTOS_SHARE_URL` | Photos 앨범 공유 링크 | 구글 포토에서 앨범 수동 공유 |
| `NOTION_URL` | 부족 안내문 노션 페이지 링크 | 노션 |
| `DRIVE_API_KEY` | 전당 영상 인앱 재생용 API 키 | GCP → 사용자 인증 정보 → API 키 |
| `NOTION_TOKEN` | 노션 Integration 토큰 | 노션 Integrations (**Phase 6에서 제거 예정**) |
| `NOTION_DB_ID` | 정기모임 캘린더 DB ID | 노션 DB (**Phase 6에서 제거 예정**) |
| `ADMINS` | 일정 확정 권한자 이름 배열 | 부족원 시트 이름과 일치 |
| `ADMIN_PIN` | 확정 시 입력 PIN | **기본값에서 반드시 변경할 것** |

> `DRIVE_API_KEY`, `NOTION_TOKEN`은 살아있는 자격증명이다. 커밋 금지. 유출 시 즉시 회전(재발급).

## 프론트 (`frontend/js/api.js` — Phase 5에서 생성)

| 값 | 설명 |
|---|---|
| `GAS_URL` (exec URL) | 백엔드 웹앱 배포 URL. `api.js` 상단 상수 한 곳에서만 관리. |

## Netlify (Phase 7)

| 설정 | 값 |
|---|---|
| Base directory | `frontend/` |
| Production branch | `main` |
| 환경변수 | (현재 없음. exec URL은 `api.js`에 직접 둠) |

## GCP (OAuth)

| 항목 | 메모 |
|---|---|
| OAuth 동의화면 | 전용 계정 기준으로 설정 |
| 테스트 사용자 | 정산 담당자 등 필요 시 추가 |
| API 키 | `DRIVE_API_KEY`용 |
