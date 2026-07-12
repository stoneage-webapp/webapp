# env — 어떤 값이 어디에 필요한가

> ⚠️ **이 문서에는 실제 값을 적지 않는다.** "무엇이 어디에 필요한지"만 설명한다.
> 실제 값 백업은 `v3.0.2/Code.local.md`(gitignore됨) 참고.

## 백엔드 — 전부 **Script Properties** 로 관리

**코드에는 실제 값이 전혀 없다.** `config.gs`가 아래 키를 Script Properties에서 읽는다.
설정 위치: Apps Script 웹에디터 → ⚙️ **프로젝트 설정 → 스크립트 속성 → 속성 추가**

| 속성 키 | 설명 | 획득 위치 | 필수 |
|---|---|---|---|
| `SPREADSHEET_ID` | 공용 Google Sheet ID | 시트 URL `/d/<ID>/edit` | ✅ |
| `DRIVE_FOLDER_ID` | 인증 사진/영상 저장 폴더 ID | Drive 폴더 URL | ✅ |
| `SETTLE_FOLDER_ID` | 월별 정산 사진 수집 폴더 ID (별도) | Drive 폴더 URL | ✅ |
| `PHOTOS_ALBUM_ID` | Google Photos 앨범 ID | `setupPhotosAlbum()` 실행 후 로그 | 선택 (비우면 Photos 업로드 생략) |
| `PHOTOS_SHARE_URL` | Photos 앨범 공유 링크 | 구글 포토에서 수동 공유 | 선택 |
| `NOTION_URL` | 부족 안내문 링크 | — | 선택 |
| `DRIVE_API_KEY` | 전당 영상 인앱 재생용 API 키 | GCP → 사용자 인증 정보 → API 키 | 선택 (없으면 iframe 재생) |
| `ADMINS` | 일정 확정 권한자, 쉼표 구분 (예: `김광훈,이희주`) | 부족원 시트 이름과 일치 | 선택 (기본 김광훈) |
| `admin_pin` | 일정 확정 관리자 PIN | 직접 정함 | ✅ |
| `settlers` | 정산 담당자 목록 — **웹 관리자 페이지에서 설정** (직접 편집 불필요) | 앱 관리 | 자동 |
| `auth_secret` | 토큰 서명 비밀키 — **최초 로그인 시 자동 생성, 손대지 말 것** | 자동 | 자동 |
| `flash_owners` / `confirmed_raid_months` / `confirmed_disaster` | 앱이 자동 관리 | 자동 | 자동 |

> - 값 수정 후에는 **재배포 필요 없음** — Script Properties는 실행 시마다 읽힌다.
> - `DRIVE_API_KEY`는 브라우저에 노출되므로 **[사람] GCP에서 HTTP 리퍼러 제한(Netlify 도메인) 필수**.
> - ⚠️ clasp 특성: `clasp push`는 원격 파일을 **전체 교체**한다. push 목록에서 파일을 빼면 원격에서 삭제되므로,
>   비밀값을 코드 파일에 두는 방식은 쓰지 않는다 (그래서 Script Properties 방식).

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
