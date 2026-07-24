/**
 * 석기시대 부족 웹앱 — config.gs
 * 실제 값(시트 ID·API 키 등)은 코드에 두지 않고 **Script Properties** 에서 읽는다.
 *   웹에디터 → ⚙️ 프로젝트 설정 → 스크립트 속성 → 아래 키 이름으로 값 추가 (docs/env.md 참고)
 * 덕분에 이 파일은 커밋/clasp push 해도 안전하다.
 */

const PROPS_ = PropertiesService.getScriptProperties();
function prop_(key, fallback) {
  const v = PROPS_.getProperty(key);
  return (v !== null && v !== '') ? v : (fallback || '');
}

const CONFIG = {
  SPREADSHEET_ID: prop_('SPREADSHEET_ID'),     // 공용 시트 ID (URL 의 /d/<ID>/edit)
  DRIVE_FOLDER_ID: prop_('DRIVE_FOLDER_ID'),   // 인증 사진/영상 저장 폴더
  SETTLE_FOLDER_ID: prop_('SETTLE_FOLDER_ID'), // 정산 사진 수집 폴더 (별도)
  PHOTOS_ALBUM_ID: prop_('PHOTOS_ALBUM_ID'),   // setupPhotosAlbum() 로그의 ID. 비우면 Photos 업로드 생략
  PHOTOS_SHARE_URL: prop_('PHOTOS_SHARE_URL'), // Photos 앨범 공유 링크 (영상 탭 버튼용)
  NOTION_URL: prop_('NOTION_URL'),             // 부족 안내문 링크 (없으면 홈 버튼이 안내만 띄움)
  OPENCHAT_URL: prop_('OPENCHAT_URL', 'https://open.kakao.com/o/g5IQRRBi'), // 오픈카톡방
  DRIVE_API_KEY: prop_('DRIVE_API_KEY'),       // 전당 영상 인앱 재생용 API 키 (GCP)

  SHEETS: {
    members: '부족원',
    raid: '정기공격일자',
    disaster: '자연재해',
    mural: '벽화',
    hall: '명예의전당',
    notices: '공지',        // 공지사항 (첫 등록 시 앱이 자동 생성)
    status: '인증현황',     // settleMonth 가 생성/갱신하는 정산 결과
    completion: '완료기록', // 정기공격/자연재해 완료 처리 기록 (첫 완료 처리 시 앱이 자동 생성)
    levels: '레벨완등'      // 레벨(난이도)별 완등 횟수 — 행=이름, 열=레벨 (첫 기록 시 앱이 자동 생성)
  },
  PHOTOS_MAX_BYTES: 45 * 1024 * 1024,  // 45MB 초과 파일은 Drive에만 저장 (Apps Script 응답 한도)

  // 일정 확정 권한자 — 스크립트 속성 ADMINS 에 쉼표 구분(예: "김광훈,이희주"). 미설정 시 기본값.
  ADMINS: prop_('ADMINS', '김광훈').split(',').map(function (s) { return s.trim(); }).filter(String),
  ADMIN_PIN: prop_('admin_pin', '0102')  // 확정 PIN — 스크립트 속성 admin_pin (auth.gs 의 getAdminPin_ 과 동일 소스)
};
