/**
 * 석기시대 부족 웹앱 — config.gs
 * 전역 상수(CONFIG). 실제 값은 커밋 금지 — v3.0.2/Code.local.md 참고.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

// ⚠️ 실제 값은 커밋 금지. 로컬 Code.local.md(gitignore됨) 참고해 웹에디터/로컬에서만 채울 것.
const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID',
  SETTLE_FOLDER_ID: 'YOUR_SETTLE_FOLDER_ID',  // 정산 사진 저장 폴더 (별도)
  PHOTOS_ALBUM_ID: 'YOUR_PHOTOS_ALBUM_ID',           // setupPhotosAlbum() 실행 후 로그의 ALBUM_ID 입력. 비워두면 Photos 업로드 생략
  PHOTOS_SHARE_URL: 'YOUR_PHOTOS_SHARE_URL',          // 구글 포토에서 앨범 공유 후 받은 링크 (영상 탭 버튼용)
  NOTION_URL: 'YOUR_NOTION_URL',                // 부족 안내문 페이지 링크 (없으면 빈 문자열 — 홈 버튼이 안내만 띄움)
  DRIVE_API_KEY: 'YOUR_DRIVE_API_KEY',             // 전당 영상 인앱 재생용 API 키 (GCP → 사용자 인증 정보 → API 키)
  SHEETS: {
    members: '부족원',
    raid: '정기공격일자',
    disaster: '자연재해',
    mural: '벽화',
    hall: '명예의전당',
    notices: '공지',        // 공지사항 (첫 등록 시 앱이 자동 생성)
    status: '인증현황'      // settleMonth 가 생성/갱신하는 정산 결과
  },
  PHOTOS_MAX_BYTES: 45 * 1024 * 1024,  // 45MB 초과 파일은 Drive에만 저장 (Apps Script 응답 한도)
  ADMINS: ['김광훈'],            // 일정 확정 권한자 (부족원 시트의 이름과 동일하게)
  ADMIN_PIN: '0102'              // 확정 시 입력할 PIN — 꼭 변경할 것
};
