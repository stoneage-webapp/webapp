# handover — 인계 문서

> 세대교체(추장 교체) 시 이 문서 한 장으로 인계가 끝나는 것이 목표.
> 실제 계정 비밀번호/토큰은 여기 적지 않는다. **"어디에 있는지"만** 적는다.

## 소유권 정리표

| 자산 | 소유 | 평소 작업 | 링크 |
|---|---|---|---|
| GitHub repo | 전용 Organization (`stoneage-webapp`) | 개인 계정 collaborator | https://github.com/stoneage-webapp/webapp |
| Netlify site | 전용 계정 | `main` push 시 자동 배포 | https://stoneage202605.netlify.app |
| Apps Script | 전용 계정 | 웹에디터 or clasp | script.google.com/d/18GNZwiecePbTqZVd4h3WfC3FbeyXiZyNXYZE9ZQtX-cFoBG2nyDXT1QX/edit |
| Google Sheet | 전용 계정 | 이미 공용 | _(기입)_ |
| Drive 폴더 | 전용 계정 | 이미 공용 | _(기입)_ |
| Photos 앨범 | 전용 계정 | 이미 공용 | _(기입)_ |
| GCP 프로젝트 | 전용 계정 | OAuth/API 키 | _(기입)_ |

## 전용 계정 정보

- 계정 정보(ID/비밀번호) 인계 위치: _(예: 오프라인 문서 / 비밀번호 관리자 — 여기 직접 적지 말 것)_
- **2단계 인증 필수.** 비밀번호는 인계 시에만 전달.

## 실제 설정값 위치

- `v3.0.2/Code.local.md` (로컬, gitignore됨) — 시트 ID, 앨범 ID, API 키 등.
- 배포 시 `apps-script/src/config.gs`의 `CONFIG`에 이 값을 채워 넣는다.

## 장애 시 확인 순서 (切り分け)

1. **프론트만 이상**? → Netlify 배포 상태/로그 확인.
2. **데이터가 안 옴**? → 브라우저에서 `<execUrl>?action=getInitData` 직접 호출.
   - JSON `{ok:true,...}` 나오면 백엔드 정상 → 프론트 문제.
   - 에러/HTML 나오면 백엔드 문제 → Apps Script 실행 로그 확인.
3. **exec URL이 바뀐 것 같다**? → `frontend/js/api.js`의 `GAS_URL`과 실제 배포 URL 비교.
   (백엔드 재배포 시 `--deploymentId`로 덮어쓰지 않으면 URL이 바뀐다.)
4. **권한 오류**? → 전용 계정 OAuth 재승인 / GCP 테스트 사용자 확인.

## 진행 현황 (GitHub Issues)

Phase별 할 일은 `stoneage-webapp/webapp`의 이슈 #1~#9로 관리. 상세는 루트 `CLAUDE.md` 참고.
