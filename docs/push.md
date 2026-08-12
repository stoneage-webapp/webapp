# push — 푸시 알림 (OneSignal)

순수 Apps Script는 웹푸시 암호화(AES-GCM/ES256)를 못 하므로 **OneSignal** 을 경유한다.
코드는 배포 완료 상태이며, **아래 활성화 3단계**를 마치면 실제로 알림이 나간다.

## 구성
| 위치 | 내용 |
|---|---|
| 프론트 `index.html` | OneSignal SDK 로더(`?mock=1` 제외) + `OneSignal.init`. App ID **공개값** 하드코딩 |
| 프론트 `onesignal/OneSignalSDKWorker.js` | OneSignal SW (스코프 `/onesignal/` — 앱 `sw.js`(`/`)와 분리) |
| 프론트 `app.js` | `initPush`(로그인 회원을 `OneSignal.login(이름)`=external_id 로 태깅), 홈 `🔔 알림 켜기`(`askPush`) |
| 백엔드 `push.gs` | `sendPush_`(OneSignal REST) + D-1/번개 인증 시간 트리거 |
| 백엔드 `config.gs` | `ONESIGNAL_APP_ID`(공개 폴백), `ONESIGNAL_REST_KEY`(**스크립트 속성**), `SITE_URL` |

## 발송 시점
- **새 공지** 등록 (`postNotice`) → 전체
- **번개 열림** (`addFlash`) → 전체
- **모임 D-1** (`pushDailyReminders_`, 매일 10시경) → 전체
- **번개 시각 직후 인증 리마인더** (`pushFlashCertCheck_`, 매시간) → 그 번개 참여자(external_id)

## ✅ 활성화 3단계 (사람)
1. **REST 키 등록** — Apps Script 편집기 → ⚙️ 프로젝트 설정 → 스크립트 속성 → 추가
   `onesignal_rest_key` = *(OneSignal REST API Key)*  ← **비밀. 코드/커밋 금지, 여기에만.**
2. **시간 트리거 설치** — 편집기에서 함수 `setupPushTriggers` 선택 → 실행 (권한 승인).
   (새 공지/번개 알림은 이벤트 발송이라 트리거 없이도 1단계만으로 동작. D-1·번개 인증만 트리거 필요.)
3. **각 회원** — 앱을 **홈 화면에 추가(iOS 16.4+ 필수)** 후 홈에서 **🔔 알림 켜기** → 브라우저 권한 허용.

## 테스트
1단계 후 **공지 하나 등록** → 알림 허용한 기기에 뜨면 성공.

## 트러블슈팅
- 안 오면 `push.gs`의 `sendPush_` 인증 헤더를 `Authorization: 'Basic ' + key` ↔ `'Key ' + key` 로 바꿔본다(OneSignal 키 버전 차이).
- 개인 지정(D-1 제외 번개 인증)이 안 가면 `include_external_user_ids` ↔ 신규 API의 `include_aliases: { external_id: [...] }` 로 조정.
- 실패는 `오류로그` 시트에 `action=sendPush` 로 기록된다.
- 트리거 제거: 함수 `removePushTriggers` 실행.

## 참고
- App ID(`cead5388-…`)는 공개값이라 프론트/코드에 있어도 안전. **REST 키만 비밀.**
- iOS는 설치형(홈 화면 추가) + 권한 허용이 있어야만 수신. 강제 불가 — 각자 켜야 함.

> ⚠️ **REST API Key 는 이 문서(공개 저장소)에 적지 말 것.** 오직 Apps Script **스크립트 속성 `onesignal_rest_key`** 에만 저장한다.
