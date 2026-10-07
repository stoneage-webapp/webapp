/**
 * 석기시대 부족 웹앱 — settlephotos.gs
 * 정산 사진 탭: **정산 지급 대상자 전용** 사진 업로드 · 조회 · 취소.
 *
 * 벽화 인증(photos.gs)과 같은 흐름(Drive 업로드 → Photos 앨범 → 시트 기록)이지만 저장소가 전부 분리돼 있다.
 *   - Drive  : CONFIG.SETTLE_PHOTO_FOLDER_ID / yyyy / MM
 *   - Photos : CONFIG.SETTLE_PHOTOS_ALBUM_ID (setupSettlePhotosAlbum 으로 만든 앨범)
 *   - Sheet  : '정산사진' (벽화와 같은 열 구조, 첫 업로드 시 자동 생성)
 * 월별 정산(settle.gs settleMonth)은 이 시트에 올라온 사진만 근거로 한다.
 *
 * 권한: 모든 action 이 정산 지급 대상자인지 서버에서 다시 확인한다(프론트의 탭 숨김은 편의일 뿐).
 * 벽화와 달리 Drive 링크를 공개하지 않고, 갤러리·홈 새 소식·getInitData 어디에도 노출하지 않는다.
 */

const SETTLE_PHOTO_DENIED = '정산 사진 권한이 없습니다. (정산 지급 대상자만)';

// 정산 지급 대상자 = 지원 대상(부족원 J열)이면서 휴면(K열) 아님 — settleMonth 의 정산 대상과 같은 기준.
function isSettleTarget_(name) {
  return splitBySupport_(ss_()).members.indexOf(name) > -1;
}
function assertSettleTarget_(name) {
  if (!isSettleTarget_(name)) throw new Error(SETTLE_PHOTO_DENIED);
}

/* ---------- 업로드 ---------- */

// requester 는 라우터에서 name+token 검증이 끝난 이름. 이후 청크 전송은 기존 uploadChunk/checkUploadStatus 재사용.
function startSettleUpload(fileName, mimeType, fileSize, ym, requester) {
  assertSettleTarget_(requester);
  if (!CONFIG.SETTLE_PHOTO_FOLDER_ID) {
    throw new Error('정산 사진 폴더가 설정되지 않았습니다. (스크립트 속성 SETTLE_PHOTO_FOLDER_ID)');
  }
  return startResumable_(fileName, mimeType, fileSize,
    resolveMonthFolder_(ym, CONFIG.SETTLE_PHOTO_FOLDER_ID));
}

function finalizeSettleProof(fileId, meta, authToken) {
  // meta: finalizeProof 와 동일 { mimeType, fileSize, participants: [], location, uploader, activityLabel }
  meta.uploader = verify_(meta.uploader, authToken);
  assertSettleTarget_(meta.uploader);
  meta.kind = '사진';
  return recordProof_(fileId, meta,
    { sheet: CONFIG.SHEETS.settlePhotos, albumId: CONFIG.SETTLE_PHOTOS_ALBUM_ID, publicLink: false });
}

// 정산 사진 취소: 업로더 본인(또는 관리자)만. Drive 파일 + '정산사진' 시트 행 삭제.
function deleteSettleProof(fileId, requester, authToken) {
  requester = verify_(requester, authToken);
  return deleteProofFrom_(CONFIG.SHEETS.settlePhotos, fileId, requester);
}

/* ---------- 조회 (정산 사진 탭 화면용) ----------
 * 반환: {
 *   ym       : 이번 달 'yyyy-MM'
 *   targets  : 정산 지급 대상자 이름 (오름차순) — 참여자 칩
 *   certified: { 이름: true } — 이번 달 정산 사진에 참여자로 올라간 대상자
 *   mine     : [{when, actDate, loc, people, fileId}] — 내가 올린 정산 사진, 최신순.
 *              이번 달 + 지난달(지난달 정산은 보통 월초에 하므로 그때까지 취소할 수 있게)
 *   shareUrl : 정산 사진 앨범 공유 링크
 * }
 */
function getSettlePhotos(requester) {
  requester = String(requester || '').trim();
  const s = ss_();
  const targets = splitBySupport_(s).members;
  if (targets.indexOf(requester) < 0) throw new Error(SETTLE_PHOTO_DENIED);
  const isTarget = {};
  targets.forEach(function (n) { isTarget[n] = true; });

  const nowYM = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const y = Number(nowYM.slice(0, 4)), mo = Number(nowYM.slice(5));
  const prevYM = mo === 1 ? (y - 1) + '-12' : y + '-' + ('0' + (mo - 1)).slice(-2);

  const certified = {};
  const mine = [];
  const sh = s.getSheetByName(CONFIG.SHEETS.settlePhotos);
  if (sh && sh.getLastRow() > 1) {
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = vals.length - 1; i >= 1; i--) {
      const r = vals[i]; // [인증일시, 활동일자, 종류, 장소, 참여자, 업로더, 링크, Photos]
      const ym = parseYM_(r[1]) || parseYM_(r[0]); // 활동일자 우선, 없으면 인증일시
      if (ym !== nowYM && ym !== prevYM) continue;
      if (ym === nowYM) {
        String(r[4]).split(',').forEach(function (n) {
          n = n.trim();
          if (isTarget[n]) certified[n] = true;
        });
      }
      if (String(r[5]).trim() === requester) {
        const m = String(r[6]).match(/\/d\/([-\w]+)/);
        mine.push({ when: r[0], actDate: r[1], loc: r[3], people: r[4], fileId: m ? m[1] : '' });
      }
    }
  }
  return { ym: nowYM, targets: targets, certified: certified, mine: mine,
           shareUrl: CONFIG.SETTLE_PHOTOS_SHARE_URL };
}

/* ---------- 1회 실행: 정산 사진 전용 Photos 앨범 생성 ----------
 * Photos API는 "앱이 생성한 앨범"에만 업로드 가능 — 구글 포토에서 손으로 만든 앨범에는 올릴 수 없다.
 * 웹에디터에서 이 함수를 한 번 실행해 앨범을 만든 뒤 로그의 ID를 스크립트 속성에 넣는다.
 */
function setupSettlePhotosAlbum() {
  const album = createPhotosAlbum_('석기시대 정산💰');
  Logger.log('ALBUM_ID: ' + album.id);
  Logger.log('→ 이 값을 스크립트 속성 SETTLE_PHOTOS_ALBUM_ID 에 넣는다 (재배포 불필요).');
  Logger.log('→ 구글 포토에서 "석기시대 정산💰" 앨범을 열어 정산 대상자에게만 수동으로 링크 공유하고,');
  Logger.log('   그 공유 링크를 스크립트 속성 SETTLE_PHOTOS_SHARE_URL 에 넣는다.');
}
