# deploy — 배포 순서

> **원칙**: `main` = 항상 실제 배포 상태.
> 프론트는 자동 배포, **백엔드는 수동 배포**라는 점이 가장 큰 함정.

## 프론트 (Netlify — 자동)

0. **배포 전 확인**: `frontend/js/api.js` 상단 `GAS_URL`이 실제 exec URL인지 (placeholder `YOUR_EXEC_URL`이면 앱이 동작하지 않음).
1. `main`에 merge → Netlify가 자동 빌드/배포.
2. Base directory = `frontend/`, Production branch = `main`. (Phase 7에서 설정)
3. HTTPS 자동 적용 (PWA/홈화면 추가에 필수 — Netlify 기본 제공).

## 백엔드 (Apps Script — 수동)

> `clasp push`(업로드)와 `clasp deploy`(배포)는 **별개**. push만으로는 사용자에게 반영 안 됨.

### 웹에디터로 배포하는 경우
1. 전용 계정으로 Apps Script 프로젝트 열기.
2. `apps-script/src/*.gs` 내용 반영 + `config.gs`의 CONFIG에 실제 값 채우기(`v3.0.2/Code.local.md`).
3. **배포 → 배포 관리 → 기존 배포 편집(연필) → 새 버전 → 배포**.
   반드시 *기존 배포를 편집*해야 exec URL이 유지된다. 새로 만들면 URL이 바뀐다.

### clasp로 배포하는 경우 (clasp 3.x 문법 — 현재 세팅)
```bash
cd apps-script
clasp push -f                 # 업로드(저장). config.gs 는 .claspignore 로 제외됨
clasp deployments             # 기존 배포 ID 확인
clasp redeploy <기존배포ID> --description "..."   # ★ 기존 배포 덮어쓰기 (URL 유지)
```
- 운영 배포 ID: `AKfycbxcMDmO6R6NHxHTBKrKbVoTcMUJaaFc7YileVOBErPDBfol3VD4Jsx_4VOOfZTRtx1J` (exec URL 의 `/s/`와 `/exec` 사이 문자열과 동일)
- ⚠️ `config.gs`의 실제 값은 **웹에디터에만** 있다. config 구조를 바꿀 땐 `.claspignore`에서 잠시 빼고 push 후, 웹에디터에서 값을 다시 채울 것.

### ⚠️ exec URL 유지 (가장 중요)
- `clasp deploy`(새 배포)를 하면 **매번 새 exec URL** → 프론트가 죽는다.
- 반드시 `clasp redeploy <기존ID>`로 덮어쓴다.
- exec URL이 바뀌면 프론트 `js/api.js` 상단 상수도 함께 교체해야 한다.

## 배포 후 검증

- **백엔드 단독 검증(프론트보다 먼저)**: 브라우저에서
  `<execUrl>?action=getInitData` 직접 호출 → `{ "ok": true, "data": {...} }` JSON이 나오면 정상.
- 백엔드를 먼저 검증하면 이후 버그를 프론트 문제로 좁힐 수 있다.

## 완결 기능 추가 시 순서 (양쪽 다 건드릴 때)

1. **DB**: Sheet에 컬럼/시트 먼저 추가
2. **Back**: action 추가 → 배포 → `?action=...` 단독 JSON 검증
3. **Front**: 그 action 호출 + 화면 표시
