\# 석기시대 클럽 앱 — 아키텍처 이전 실행 계획 (Claude Code 인계용)



> 이 문서는 기존 Google Apps Script 단일 웹앱을 \*\*3-tier 구조로 분리\*\*하고,

> GitHub 중심으로 정리해 \*\*인계 가능한 형태\*\*로 만드는 전체 프로세스다.

> 각 Phase는 순서대로 진행한다. `\[사람]` 표시는 사람이 직접 해야 하는 작업(계정·OAuth·UI 연결 등),

> 나머지는 코드/파일 작업이다.



\---



\## 0. 배경과 목표



\### 현재 상태 (AS-IS)

\- Google Apps Script 단일 웹앱 하나가 \*\*화면(HTML) + 로직 + 데이터 접근\*\*을 전부 담당.

\- 기능: 투표, 사진 인증, 벽화 갤러리(mural), 명예의 전당, 정산, PIN 기반 신원확인.

\- DB는 이미 공용화됨: \*\*공용 Google Sheet + 공용 Google Photos 앨범 + 공용 Google Drive\*\*.

\- 가이드라인/모임일자는 개인 Notion에서 운영. \*\*모임일자에만 Notion API 사용 중.\*\*

\- 문제점:

&#x20; - iOS/Android 홈 화면 아이콘이 GAS iframe 구조 때문에 제대로 안 붙음(스크린샷 자동생성).

&#x20; - favicon / apple-touch-icon / manifest를 GAS가 sanitize해서 못 넣음.

&#x20; - 코드·배포·소유권이 \*\*개인 계정\*\*에 흩어져 있어 세대교체(추장 교체) 시 인계가 어려움.



\### 목표 구조 (TO-BE)

```

Front (Netlify) ──JSON──▶ Back (Apps Script) ──▶ DB (Google Sheet/Drive/Photos)

&#x20;  정적 HTML/CSS/JS          JSON API 서버            실제 데이터

&#x20;  PWA 아이콘/manifest        투표/PIN/사진 로직

```

\- \*\*핵심 원칙 1 — 통신 방향\*\*: Front는 절대 Sheet에 직접 접근하지 않는다. 반드시 `Front → Back → DB` 순서. (권한/키 노출 방지, Apps Script가 PIN 검증 등 문지기 역할)

\- \*\*핵심 원칙 2 — 전용 계정 꾸러미\*\*: 모든 디지털 자산의 소유를 \*\*동아리 전용 Google 계정\*\* 하나로 통일. 세대교체 시 "계정 정보 한 장" 인계로 끝나게 한다.

\- \*\*핵심 원칙 3 — GitHub 기준본\*\*: 프론트/백엔드 코드 + 인계 문서를 GitHub 한 곳에서 버전관리. main = 항상 실제 배포 상태.



\### 이미 완료된 것

\- \[x] 동아리 전용 Google 계정 존재 (DB 공용화 완료)

\- \[x] 전용 계정으로 GitHub \*\*Organization + repo\*\* 생성

\- \[x] 개인 계정을 Organization 멤버로 초대 (평소 작업은 개인 계정)



\---



\## 1. 레포 뼈대 세팅



\### 목표 폴더 구조

```

club-app/

├─ frontend/            # Netlify 배포 대상 (정적 사이트)

│  ├─ index.html

│  ├─ css/

│  ├─ js/

│  │  ├─ api.js         # ★ GAS 호출을 전부 몰아넣는 유일한 창구

│  │  └─ app.js         # 화면 로직

│  ├─ manifest.json

│  └─ icons/            # favicon.ico, icon-180/192/512.png

├─ apps-script/         # clasp로 Apps Script와 연결

│  ├─ appsscript.json

│  ├─ src/

│  │  ├─ Code.gs        # doGet/doPost 라우팅

│  │  ├─ votes.gs

│  │  ├─ photos.gs

│  │  ├─ auth.gs        # PIN 검증

│  │  └─ config.gs      # 시트 ID 등 상수 (실제 값은 커밋 주의)

│  └─ README.md

├─ docs/

│  ├─ architecture.md

│  ├─ deploy.md

│  ├─ env.md

│  └─ handover.md

├─ README.md

└─ .gitignore

```



\### 할 일

\- \[ ] 위 폴더 구조 생성 (빈 폴더는 `.gitkeep`으로 유지)

\- \[ ] `.gitignore` 작성 (아래 내용 기준)

\- \[ ] 루트 `README.md`에 프로젝트 한 줄 소개 + docs 링크



\### .gitignore (필수)

```gitignore

\# clasp — 인증 토큰은 절대 커밋 금지

.clasprc.json



\# 민감 정보 / 실제 값

.env

\*.key

config.local.js        # exec URL, 시트 ID 등 실제 값 로컬 보관용



\# OS / 에디터 / 의존성

.DS\_Store

node\_modules/

```

> ⚠️ \*\*exec URL, 스프레드시트 ID, API 토큰 등 실제 값이 코드에 하드코딩된 채 커밋되지 않도록 한다.\*\*

> 실제 값은 `docs/env.md`에 "무엇이 어디에 필요한지" 설명만 두고, 값 자체는 별도 관리.

> (repo는 되도록 \*\*Private\*\* 권장)



\---



\## 2. 인계 문서 4종 작성 (docs/)



> 인계의 진짜 핵심은 코드가 아니라 이 문서들이다. 뼈대만 먼저 만들고 진행하며 채운다.



\- \[ ] \*\*architecture.md\*\*: Front/Back/DB 구조, 데이터 흐름, 어떤 화면이 어떤 `action`을 호출하는지

\- \[ ] \*\*deploy.md\*\*: 프론트 배포(Netlify 자동) / 백엔드 배포(clasp 또는 웹에디터) 순서, exec URL 유지 방법

\- \[ ] \*\*env.md\*\*: exec URL / 스프레드시트 ID / Photos 앨범 ID / Netlify 환경변수 등 "어떤 값이 어디에 필요한지"

\- \[ ] \*\*handover.md\*\*: 전용 계정 정보 인계 위치, GitHub repo, Netlify site, Apps Script project, Sheet/Drive/Photos 링크, GCP 프로젝트(OAuth 테스트 사용자 설정), 장애 시 확인 순서



\### API 명세 표 (architecture.md 또는 README에 포함)

| action | method | params | 반환 |

|---|---|---|---|

| getVotes | GET | - | 투표 현황 배열 |

| submitVote | POST | pin, choice | { success, message } |

| getHallOfFame | GET | - | 명예의 전당 목록 |

| (사진/정산/mural도 동일 형식으로 추가) | | | |



\---



\## 3. Apps Script 리팩터링 (화면 제거 → JSON API화)



> 기존 로직 함수(투표/PIN/사진/정산 등)는 \*\*거의 그대로 재사용\*\*하고,

> "화면을 그리던 부분(HtmlService)"만 걷어내 JSON을 반환하도록 바꾼다.



\### 변경 방향

```javascript

// AS-IS: 화면 반환

function doGet(e) {

&#x20; return HtmlService.createHtmlOutput(buildVotingPageHtml());

}



// TO-BE: 데이터만 반환 (action 파라미터로 분기)

function doGet(e) {

&#x20; const action = e.parameter.action;

&#x20; let result;

&#x20; if (action === 'getVotes') result = getVoteData();

&#x20; else if (action === 'getHallOfFame') result = getHallOfFameData();

&#x20; // 기존 로직 함수 재사용

&#x20; return ContentService.createTextOutput(JSON.stringify(result))

&#x20;   .setMimeType(ContentService.MimeType.JSON);

}



function doPost(e) {

&#x20; const data = JSON.parse(e.postData.contents);   // text/plain으로 받은 body 파싱

&#x20; let result;

&#x20; if (data.action === 'submitVote') result = submitVote(data);

&#x20; // ...

&#x20; return ContentService.createTextOutput(JSON.stringify(result))

&#x20;   .setMimeType(ContentService.MimeType.JSON);

}

```



\### ⚠️ CORS 함정 (반드시 지킬 것)

\- GAS 웹앱은 브라우저의 사전확인 요청(OPTIONS)을 처리 못 함.

\- 따라서 프론트에서 POST 시 \*\*`Content-Type: application/json` 금지\*\*.

\- 반드시 \*\*`text/plain;charset=utf-8`\*\* 으로 보내고, GAS에서 `JSON.parse(e.postData.contents)`로 파싱한다.

\- GET은 이 문제 없음.



\### 성능 개선 여지

\- 자주 조회되는 집계(명예의 전당 등)는 `CacheService`로 수십 초\~수 분 캐싱 고려.

\- 프론트에서 여러 데이터를 동시에 부를 때는 `Promise.all(\[...])`로 병렬 호출.



\### 할 일

\- \[ ] `action` 라우팅 구조로 doGet/doPost 재작성

\- \[ ] 기존 HTML 생성 코드 제거, 로직 함수는 유지

\- \[ ] `config.gs`에 시트 ID 등 상수 분리

\- \[ ] `\[사람]` 웹 에디터/`clasp`로 배포 후, 브라우저에서 `...exec?action=getVotes` 직접 호출해 \*\*JSON이 나오는지 단독 검증\*\* (프론트 만들기 전에)



\---



\## 4. clasp 연동 (Apps Script ↔ GitHub)



> 목적은 로컬 개발이 아니라 \*\*인계용 백업/버전관리\*\*. 배포는 clasp로 해도 되고 웹에디터로 해도 된다.



\### ⚠️ 순서 주의

\- \*\*먼저 Apps Script 프로젝트가 전용 계정 소유여야 한다.\*\* (Phase 8과 연동)

\- 개인 계정에서 clone 후 계정을 옮기면 스크립트 ID와 로그인 계정이 어긋난다.



\### `\[사람]` 초기 세팅 (WSL/PowerShell)

```bash

npm install -g @google/clasp

clasp login                      # 전용 계정으로 로그인

clasp clone <스크립트ID>          # apps-script/ 안에서 실행되도록 .clasp.json 위치 조정

```

\- `.clasp.json`이 `apps-script/` 폴더를 rootDir로 바라보게 설정.

\- `.clasprc.json`(토큰)은 \*\*절대 커밋 금지\*\* (.gitignore 확인).



\### 평소 흐름

```bash

\# 웹에디터에서 편집·배포하는 경우 → 백업만

clasp pull

git add . \&\& git commit -m "\[back] ..." \&\& git push



\# clasp로 배포까지 하는 경우

clasp push                       # 업로드(저장). 이것만으론 운영 반영 안 됨

clasp deployments                # 기존 배포 ID 확인

clasp deploy --deploymentId <기존ID> --description "..."   # ★ 기존 배포 덮어쓰기

```



\### ⚠️ exec URL 유지 (가장 중요한 함정)

\- `clasp deploy`를 옵션 없이 하면 \*\*매번 새 배포 = 새 exec URL 발급\*\* → 프론트가 죽는다.

\- 반드시 \*\*`--deploymentId <기존ID>`로 기존 배포를 덮어써서 URL을 유지\*\*한다.

\- `clasp push`(업로드)와 `clasp deploy`(배포)는 별개. push만으론 사용자에게 반영 안 됨.



\---



\## 5. 프론트 정적 사이트 구축 (Netlify용)



\### 할 일

\- \[ ] 기존 GAS HTML 화면들을 `frontend/`의 정적 HTML/CSS/JS로 이전

\- \[ ] \*\*`js/api.js` — GAS 호출을 전부 이 파일 하나에 몰아넣기\*\* (화면 코드는 `getVotes()` 같은 함수만 호출)

\- \[ ] exec URL은 `api.js` 상단 상수 한 곳에만 (실제 값은 env.md/로컬 관리)



\### api.js 호출 패턴

```javascript

const GAS\_URL = '...';  // exec URL (한 곳에서만 관리)



// 조회 (GET)

export async function getVotes() {

&#x20; const res = await fetch(`${GAS\_URL}?action=getVotes`);

&#x20; return res.json();

}



// 제출 (POST) — 반드시 text/plain

export async function submitVote(pin, choice) {

&#x20; const res = await fetch(GAS\_URL, {

&#x20;   method: 'POST',

&#x20;   headers: { 'Content-Type': 'text/plain;charset=utf-8' },

&#x20;   body: JSON.stringify({ action: 'submitVote', pin, choice }),

&#x20; });

&#x20; return res.json();

}

```



\### PWA / 홈 화면 아이콘 (이번 이전의 핵심 목적)

\- \[ ] `icons/`에 정사각형 PNG 준비: `icon-180.png`(iOS), `icon-192.png`, `icon-512.png`(Android), `favicon.ico`

&#x20; - 512 이상 원본 하나로 리사이즈. \*\*maskable 대비 로고 핵심은 가운데 80% 안에\*\* 배치.

\- \[ ] `<head>`에 절대경로로 링크:

```html

<link rel="icon" href="/favicon.ico">

<link rel="apple-touch-icon" href="/icon-180.png">

<meta name="apple-mobile-web-app-capable" content="yes">

<meta name="apple-mobile-web-app-title" content="석기시대">

<link rel="manifest" href="/manifest.json">

<meta name="theme-color" content="#4a3728">

```

\- \[ ] `manifest.json` 작성 (name/short\_name/start\_url/display:standalone/icons 192·512)



\### 홈 화면 추가 버튼 (선택)

\- 기기 감지해서 안내형 버튼 제공 가능(iOS는 공유→홈화면 추가 안내, Android는 안내 or 서비스워커 붙이면 `beforeinstallprompt` 원클릭).

\- iOS 원클릭 설치는 Apple 정책상 불가 — 안내형까지가 최선. \*\*단, 아이콘은 이제 제대로 나온다.\*\*



\---



\## 6. Notion 모임일자 → Google로 이전 (Notion API 의존성 제거)



> Notion API는 \*\*모임일자 하나\*\*에만 물려 있음. 가이드라인은 API 무관(단순 문서).

> 모임일자는 날짜 데이터라 이미 가진 Google 도구가 더 잘 맞는다.



\### 방향 선택 (사람이 결정 필요)

\- \*\*방향 A — Google Sheet 탭\*\* (권장, 현 구조와 100% 일관): "다음 모임 언제" 목록 수준이면 이걸로. Notion API 호출을 Sheet 읽기로 교체.

\- \*\*방향 B — Google Calendar API\*\*: 회원이 개인 캘린더 구독/알림/반복 일정이 필요하면.



\### 할 일

\- \[ ] `\[사람]` A/B 결정 (모임일자에 참석자/장소 등 부가정보·달력뷰가 필요한지에 따라)

\- \[ ] 결정된 소스로 데이터 이전

\- \[ ] Apps Script에서 Notion API 호출 코드 제거 → Sheet(또는 Calendar) 읽기로 교체

\- \[ ] 가이드라인 문서 처리 결정: Notion 유지(API 없어 리스크 작음) / GitHub Pages / 웹앱 가이드 탭 중 택1



\---



\## 7. Netlify 배포 연결



\### `\[사람]` 할 일

\- \[ ] \*\*전용 계정\*\*으로 Netlify 가입/로그인

\- \[ ] New site from Git → Organization의 club-app repo 연결

\- \[ ] Base directory를 `frontend/`로 지정

\- \[ ] \*\*Production branch = main\*\* (main에 merge되면 자동 배포)

\- \[ ] HTTPS 자동 적용 확인(PWA/iOS 홈화면 추가에 필수 — Netlify는 기본 제공)

\- \[ ] (선택) 커스텀 도메인 연결



\---



\## 8. 전용 계정으로 소유권 통일



> DB는 이미 공용. 남은 건 Apps Script 실행 주체 + Netlify/GitHub 소유.



\### `\[사람]` 할 일

\- \[ ] Apps Script를 \*\*전용 계정 소유\*\*로 이전(또는 전용 계정에서 재생성)

&#x20; - 이전 시 exec URL 유지 여부 확인. 새 URL이면 `api.js`의 URL 교체 필요.

&#x20; - OAuth 권한을 전용 계정으로 재승인.

&#x20; - GCP 프로젝트(OAuth 동의화면, 정산 담당 테스트 사용자 등)를 전용 계정 기준으로 재연결.

\- \[ ] GitHub repo — 이미 전용 Organization 소유 ✔ / 개인 계정은 collaborator로 작업 ✔

\- \[ ] Netlify — 전용 계정 소유(Phase 7에서 처리)

\- \[ ] 전용 계정 \*\*2단계 인증 필수 설정\*\*, 비밀번호는 인계 시에만 전달하는 규칙



\### 소유권 정리표 (완료 후 handover.md에 기록)

| 자산 | 소유 | 평소 작업 |

|---|---|---|

| GitHub repo | 전용 Organization | 개인 계정 collaborator |

| Netlify site | 전용 계정 | main push 시 자동 배포 |

| Apps Script | 전용 계정 | 웹에디터 or clasp |

| Sheet/Drive/Photos | 전용 계정 | 이미 공용 |



\---



\## 9. 브랜치 전략 \& 작업 흐름



> 혼자 관리 + 15명 규모에 맞춘 최소 전략. \*\*main = 항상 실제 배포 상태.\*\*



\### 브랜치

\- \*\*main\*\*: 배포된 상태와 일치하는 기준 브랜치(진실의 기준).

\- \*\*작업 브랜치\*\*: 기능/수정 시 일회용으로 파고, merge 후 삭제.

&#x20; - 접두어: `feat/xxx`(기능), `fix/xxx`(버그), `docs/xxx`(문서)



\### 표준 흐름

```bash

git checkout main \&\& git pull

git checkout -b feat/difficulty-tag

\# 작업 + 커밋 (접두어 \[front]/\[back]/\[both])

git commit -m "\[back] 난이도 태그 저장 API 추가"

git push -u origin feat/difficulty-tag

\# GitHub에서 PR 생성 → 본인 검토 → merge → 브랜치 삭제

```

\- 혼자여도 PR 사용: 변경 이력이 묶이고, merge 전 exec URL 하드코딩 등 실수 점검 가능.

\- 오타 등 사소한 수정은 main 직접 커밋 OK. 규칙에 과하게 얽매이지 말 것.



\### 배포 연동

\- \*\*프론트\*\*: main merge → Netlify 자동 배포.

\- \*\*백엔드\*\*: main merge → \*\*수동으로 clasp/웹에디터 배포\*\* 필요(자동 아님). main과 실제 Apps Script가 어긋나지 않게 습관화.



\### 완결 기능 추가 시 작업 순서 (양쪽 다 건드릴 때)

1\. \*\*DB\*\*: Sheet에 컬럼/시트 먼저 추가

2\. \*\*Back\*\*: API 추가 → 배포 → `...exec?action=...` 단독 JSON 검증

3\. \*\*Front\*\*: 그 API 호출 + 화면 표시

> 백엔드를 프론트보다 먼저 단독 검증하면, 이후 버그를 프론트 문제로만 좁힐 수 있다.



\---



\## 10. 전체 진행 순서 요약 (체크리스트)



```

\[1] 레포 뼈대 + .gitignore + README            ← 코드 작업

\[2] docs/ 4종 뼈대 생성                          ← 코드 작업

\[3] Apps Script를 JSON API로 리팩터링           ← 코드 작업 (+ 사람: 배포·검증)

\[8] 전용 계정으로 Apps Script 소유 이전          ← 사람 (clasp 전에 선행)

\[4] clasp 연동 (전용 계정 로그인 기준)           ← 사람 초기세팅 + 코드

\[5] 프론트 정적 사이트 + PWA 아이콘/manifest     ← 코드 작업

\[6] Notion 모임일자 → Sheet/Calendar 이전        ← 사람 결정 + 코드

\[7] Netlify 배포 연결 (main 자동배포)            ← 사람

\[9] 브랜치 전략 정착 + docs 최종 채우기          ← 운영

```

> 의존성 주의: \*\*\[8](전용 계정 소유 이전)은 \[4](clasp clone)보다 먼저\*\*.

> exec URL이 확정된 뒤 \[5]의 `api.js`에 박는 것이 안전.



\---



\## 부록: 지켜야 할 함정 모음 (한눈에)

1\. \*\*POST는 `text/plain`\*\* 으로 보내고 GAS에서 파싱 (application/json 금지 — CORS).

2\. \*\*Front는 Sheet 직접 접근 금지\*\*, 항상 Back 경유.

3\. \*\*`clasp deploy`는 `--deploymentId`로 기존 배포 덮어쓰기\*\* (exec URL 유지).

4\. \*\*`.clasprc.json`(토큰) 커밋 금지\*\*, exec URL/ID 하드코딩 커밋 주의.

5\. \*\*\[8] 계정 이전을 \[4] clasp clone보다 먼저\*\*.

6\. \*\*PWA 아이콘 경로는 절대경로\*\*, HTTPS 필수(Netlify 기본).

7\. \*\*백엔드는 main merge 후 수동 배포\*\* — GitHub main과 실제 Apps Script 상태 일치 유지.

8\. iOS 원클릭 설치는 \*\*불가\*\*(정책). 안내형 버튼까지가 최선. 아이콘은 정상화됨.

