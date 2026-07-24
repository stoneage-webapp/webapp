/**
 * 석기시대 부족 웹앱 — members.gs
 * 부족원 명단 관리 (관리자 전용): 추가 / 이름 수정 / 삭제.
 *
 * 부족원 시트는 A=이름, I=PIN, J=지원여부(docs/sheets.md). 이 파일은 **A열(이름)만** 다룬다.
 *  - 추가: 맨 아래에 이름 한 칸 append. PIN 은 본인이 첫 로그인 때 정하고(auth.gs loginWithPin),
 *          지원여부(J)는 빈칸 = 지원 대상.
 *  - 수정: A열 이름만 변경(PIN·지원여부는 같은 행이라 자동 유지). 정산 담당자 목록도 함께 동기화.
 *  - 삭제: 행 전체 제거(PIN·지원여부도 함께 사라짐). 담당자 목록에서도 제거.
 *
 * ⚠️ 과거 기록(투표/벽화/전당/공지/인증현황 등)은 **이전 이름 문자열로 남는다** — 이름을 키로 쓰는
 *    시트가 많아 일괄 치환은 위험하므로 하지 않는다. UI(프론트)에서 이 점을 사용자에게 고지한다.
 * ⚠️ 관리자 이름은 앱에서 수정/삭제 불가 — 관리 권한이 Script Property 'ADMINS'(이름 기준)에 묶여 있어
 *    앱에서 바꾸면 권한이 어긋난다. 필요 시 시트/속성에서 직접.
 */

// 이름 유효성 (추가·수정 공통). 트림 후 비었거나, 쉼표 포함(참여자 CSV 파싱이 깨짐), 과도한 길이면 거부.
function assertValidMemberName_(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('이름을 입력하세요.');
  if (name.indexOf(',') > -1) throw new Error('이름에 쉼표(,)는 쓸 수 없어요.');
  if (name.length > 20) throw new Error('이름이 너무 길어요. (20자 이내)');
  return name;
}

// 현재 명단 스냅샷: { 이름 → 행번호(1-based) }. 공백 행은 건너뛴다.
function memberRowMap_(sheet) {
  const map = {};
  const last = sheet.getLastRow();
  if (last < 2) return map;
  const rows = sheet.getRange('A2:A' + last).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    const n = String(rows[i][0]).trim();
    if (n) map[n] = i + 2;
  }
  return map;
}

// 변경 후 프론트가 즉시 반영할 최신 명단/지원맵/담당자. (getInitData 의 members·support 와 동일 형식)
function memberSnapshot_() {
  const split = splitBySupport_(ss_());
  const support = {};
  split.all.forEach(function (m) { support[m.name] = m.supported; });
  return {
    members: split.all.map(function (m) { return m.name; }), // 이름 오름차순
    support: support,
    settlers: getSettlers_()
  };
}

function addMember(newName, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 부족원을 추가할 수 있습니다.');
  newName = assertValidMemberName_(newName);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ss_().getSheetByName(CONFIG.SHEETS.members);
    if (memberRowMap_(sheet)[newName]) throw new Error('이미 명단에 있는 이름이에요: ' + newName);
    sheet.appendRow([newName]); // A열만 — PIN(I)은 첫 로그인 때 본인이 설정, 지원여부(J) 빈칸=지원
    return memberSnapshot_();
  } finally {
    lock.releaseLock();
  }
}

function renameMember(oldName, newName, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 부족원 이름을 수정할 수 있습니다.');
  oldName = String(oldName || '').trim();
  newName = assertValidMemberName_(newName);
  if (!oldName) throw new Error('수정할 대상이 없습니다.');
  if (isAdmin_(oldName)) throw new Error('관리자 이름은 앱에서 수정할 수 없어요. (시트에서 직접)');
  if (oldName === newName) return memberSnapshot_(); // 변화 없음
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ss_().getSheetByName(CONFIG.SHEETS.members);
    const map = memberRowMap_(sheet);
    if (!map[oldName]) throw new Error('명단에 없는 이름입니다: ' + oldName);
    if (map[newName]) throw new Error('이미 명단에 있는 이름이에요: ' + newName);
    sheet.getRange(map[oldName], 1).setValue(newName); // A열 이름만 변경(PIN·지원여부는 같은 행이라 유지)
    renameInSettlers_(oldName, newName);               // 정산 담당자 목록 동기화
    clearPinFail_(oldName);                             // 옛 이름의 로그인 실패 잠금 정리
    return memberSnapshot_();
  } finally {
    lock.releaseLock();
  }
}

function deleteMember(targetName, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 부족원을 삭제할 수 있습니다.');
  targetName = String(targetName || '').trim();
  if (!targetName) throw new Error('삭제할 대상이 없습니다.');
  if (isAdmin_(targetName)) throw new Error('관리자 이름은 앱에서 삭제할 수 없어요. (시트에서 직접)');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ss_().getSheetByName(CONFIG.SHEETS.members);
    const map = memberRowMap_(sheet);
    if (!map[targetName]) throw new Error('명단에 없는 이름입니다: ' + targetName);
    sheet.deleteRow(map[targetName]);  // 행 전체 제거 (PIN·지원여부 포함)
    removeFromSettlers_(targetName);
    clearPinFail_(targetName);
    return memberSnapshot_();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 정산 담당자(Script Property 'settlers') 이름 동기화 ---------- */
function renameInSettlers_(oldName, newName) {
  const cur = getSettlers_();
  const i = cur.indexOf(oldName);
  if (i > -1) {
    cur[i] = newName;
    PropertiesService.getScriptProperties().setProperty('settlers', JSON.stringify(cur));
  }
}
function removeFromSettlers_(name) {
  const cur = getSettlers_();
  const next = cur.filter(function (n) { return n !== name; });
  if (next.length !== cur.length) {
    PropertiesService.getScriptProperties().setProperty('settlers', JSON.stringify(next));
  }
}
