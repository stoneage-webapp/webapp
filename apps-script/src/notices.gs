/**
 * 석기시대 부족 웹앱 — notices.gs
 * 공지사항 (#24). '공지' 시트: [등록일시, 작성자, 내용]
 * 시트는 첫 공지 등록 시 자동 생성 — 수동 DB 작업 불필요.
 */

function noticesSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.notices);
  if (!sh) sh = s.insertSheet(CONFIG.SHEETS.notices);
  if (sh.getLastRow() === 0) sh.appendRow(['등록일시', '작성자', '내용']);
  return sh;
}

// 최신순 목록. row 는 삭제 시 대조용 (시트 행 번호)
function getNotices(limit) {
  limit = limit || 20;
  const sh = ss_().getSheetByName(CONFIG.SHEETS.notices);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const vals = sh.getDataRange().getDisplayValues();
  const items = [];
  for (let i = vals.length - 1; i >= 1 && items.length < limit; i--) {
    const r = vals[i];
    if (!r[2]) continue;
    items.push({ when: r[0], by: r[1], text: r[2], row: i + 1 });
  }
  return { items: items };
}

// 관리자만 등록
function postNotice(text, name, authToken) {
  name = verify_(name, authToken);
  if (!isAdmin_(name)) throw new Error('관리자만 공지를 등록할 수 있습니다.');
  text = String(text || '').trim();
  if (!text) throw new Error('공지 내용을 입력하세요.');
  if (text.length > 2000) throw new Error('공지는 2000자 이내로 작성하세요.');
  noticesSheet_().appendRow([new Date(), name, text]);
  return getNotices();
}

// 관리자만 삭제. when(등록일시 표시값) 대조로 행 밀림 오삭제 방지
function deleteNotice(row, when, name, authToken) {
  name = verify_(name, authToken);
  if (!isAdmin_(name)) throw new Error('관리자만 공지를 삭제할 수 있습니다.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.notices);
    row = Number(row);
    if (!sh || !row || row < 2 || row > sh.getLastRow()) {
      throw new Error('해당 공지를 찾을 수 없습니다.');
    }
    const cur = sh.getRange(row, 1).getDisplayValue();
    if (String(cur) !== String(when)) {
      throw new Error('목록이 갱신되었습니다. 새로고침 후 다시 시도해주세요.');
    }
    sh.deleteRow(row);
    return getNotices();
  } finally {
    lock.releaseLock();
  }
}
