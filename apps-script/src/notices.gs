/**
 * 석기시대 부족 웹앱 — notices.gs
 * 공지사항 (#24). '공지' 시트: [등록일시, 작성자, 내용, 고정]
 * 시트는 첫 공지 등록 시 자동 생성 — 수동 DB 작업 불필요.
 * 고정(D열)이 truthy 인 공지는 홈에 항상 노출. 홈은 "고정 공지 전부 + 최신 1건"만 보여준다.
 */

function noticesSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.notices);
  if (!sh) sh = s.insertSheet(CONFIG.SHEETS.notices);
  if (sh.getLastRow() === 0) sh.appendRow(['등록일시', '작성자', '내용', '고정']);
  return sh;
}

// 최신순 전체 목록. row 는 삭제/고정 시 대조용(시트 행 번호). pinned = D열 truthy
function getNotices(limit) {
  limit = limit || 20;
  const sh = ss_().getSheetByName(CONFIG.SHEETS.notices);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const vals = sh.getDataRange().getDisplayValues();
  const items = [];
  for (let i = vals.length - 1; i >= 1 && items.length < limit; i--) {
    const r = vals[i];
    if (!r[2]) continue;
    items.push({ when: r[0], by: r[1], text: r[2], row: i + 1, pinned: isPinned_(r[3]) });
  }
  return { items: items };
}

function isPinned_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s !== '' && s !== 'FALSE' && s !== '0' && s !== 'N' && s !== 'X';
}

/* 홈 노출용: 고정 공지 전부(최신순) + 고정이 아닌 최신 1건. (중복 없이) */
function getHomeNotices_() {
  const all = getNotices(200).items; // 이미 최신순
  const pinned = all.filter(function (n) { return n.pinned; });
  const latestUnpinned = all.filter(function (n) { return !n.pinned; })[0];
  const home = pinned.slice();
  if (latestUnpinned) home.push(latestUnpinned);
  return home;
}

// 등록/삭제/고정 후 프론트가 목록과 홈을 한 번에 갱신하도록 둘 다 반환
function noticesPayload_() {
  return { items: getNotices().items, home: getHomeNotices_() };
}

// 관리자만 등록
function postNotice(text, name, authToken) {
  name = verify_(name, authToken);
  if (!isAdmin_(name)) throw new Error('관리자만 공지를 등록할 수 있습니다.');
  text = String(text || '').trim();
  if (!text) throw new Error('공지 내용을 입력하세요.');
  if (text.length > 2000) throw new Error('공지는 2000자 이내로 작성하세요.');
  noticesSheet_().appendRow([new Date(), name, text, '']); // 신규는 고정 아님
  return noticesPayload_();
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
    if (String(sh.getRange(row, 1).getDisplayValue()) !== String(when)) {
      throw new Error('목록이 갱신되었습니다. 새로고침 후 다시 시도해주세요.');
    }
    sh.deleteRow(row);
    return noticesPayload_();
  } finally {
    lock.releaseLock();
  }
}

// 관리자만 고정/해제. when 대조로 행 밀림 오적용 방지. pinned=true면 고정, false면 해제
function pinNotice(row, when, pinned, name, authToken) {
  name = verify_(name, authToken);
  if (!isAdmin_(name)) throw new Error('관리자만 공지를 고정할 수 있습니다.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = noticesSheet_(); // 헤더('고정') 보장
    row = Number(row);
    if (!row || row < 2 || row > sh.getLastRow()) {
      throw new Error('해당 공지를 찾을 수 없습니다.');
    }
    if (String(sh.getRange(row, 1).getDisplayValue()) !== String(when)) {
      throw new Error('목록이 갱신되었습니다. 새로고침 후 다시 시도해주세요.');
    }
    sh.getRange(row, 4).setValue(pinned ? '고정' : ''); // D열
    return noticesPayload_();
  } finally {
    lock.releaseLock();
  }
}
