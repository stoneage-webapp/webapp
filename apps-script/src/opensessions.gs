/**
 * 석기시대 부족 웹앱 — opensessions.gs
 * 정기 오픈 세션 — 특정 날짜(들) + 장소로 여는 자유 참가 세션. 투표/참석확정 없이 정보 게시용.
 *
 * 저장: '오픈세션' 시트 — A=ID, B=날짜('yyyy-MM-dd'), C=장소, D=설명, E=개설자, F=등록일시, G=참여자(쉼표).
 *      첫 개설 시 앱이 자동 생성. ID는 Utilities.getUuid() — 행 순서가 바뀌어도(삭제 등) 안전하게 찾기 위함.
 *      Script Property 'open_session_roles' = 개설 가능 직책 배열(기본 ['팀장'])
 *
 * 권한: 개설(add)은 관리자 또는 open_session_roles 에 포함된 직책만(canOpenSession_).
 *      수정/삭제는 개설자 또는 관리자만(자연재해 번개와 동일한 소유권 패턴).
 *      개설 가능 직책 설정(setOpenSessionRoles)은 관리자 전용.
 *      참여의사(toggleOpenSessionVote)는 번개(toggleVote)와 동일하게 로그인한 누구나. 개설자는 자동으로 첫 참여자.
 * 개설 시 번개(addFlash)와 동일하게 sendPush_ 로 전체 푸시를 보낸다.
 */

function getOpenSessionRoles_() {
  const v = PropertiesService.getScriptProperties().getProperty('open_session_roles');
  if (v) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  return ['팀장'];
}
function setOpenSessionRoles_(arr) {
  PropertiesService.getScriptProperties().setProperty('open_session_roles', JSON.stringify(arr));
}

function canOpenSession_(name) {
  if (isAdmin_(name)) return true;
  const m = splitBySupport_(ss_()).all.find(function (x) { return x.name === name; });
  const role = m ? m.role : ROLES[0];
  return getOpenSessionRoles_().indexOf(role) > -1;
}

// '오픈세션' 시트 확보 + 헤더 보장 (첫 개설 시 자동 생성, G열은 기존 시트에도 멱등하게 보강)
function openSessionSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.opensessions);
  if (!sh) {
    sh = s.insertSheet(CONFIG.SHEETS.opensessions);
    sh.appendRow(['ID', '날짜', '장소', '설명', '개설자', '등록일시', '참여자']);
  } else if (String(sh.getRange(1, 7).getDisplayValue()).trim() !== '참여자') {
    sh.getRange(1, 7).setValue('참여자');
  }
  return sh;
}

function getOpenSessionsRaw_() {
  const sh = openSessionSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, 7).getDisplayValues();
  return vals.filter(function (r) { return r[0]; }).map(function (r) {
    return { id: r[0], date: r[1], loc: r[2], note: r[3], createdBy: r[4], createdAt: r[5],
      voters: String(r[6] || '').split(',').map(function (n) { return n.trim(); }).filter(Boolean) };
  });
}

// (시트, ID) → 행번호(1-based). 없으면 0.
function findOpenSessionRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return i + 2;
  }
  return 0;
}

// 공개 조회 — 목록(날짜 표준 표기 dateInfo 포함) + 개설 가능 직책(권한 판단용)
function getOpenSessions() {
  const items = getOpenSessionsRaw_().map(function (s) {
    return { id: s.id, date: s.date, loc: s.loc, note: s.note, createdBy: s.createdBy,
      createdAt: s.createdAt, voters: s.voters, dateInfo: dateInfo_(s.date, String(s.date || '').slice(0, 7)) };
  });
  return { items: items, roles: getOpenSessionRoles_() };
}

function assertValidDate_(date) {
  date = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식 오류 (yyyy-MM-dd): ' + date);
  return date;
}

// dates: ['2026-09-12','2026-09-19', ...] — 같은 장소/설명으로 한 번에 여러 날짜를 등록
function addOpenSession(dates, loc, note, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!canOpenSession_(requester)) throw new Error('정기 오픈 세션을 열 수 있는 직책이 아닙니다.');
  if (!Array.isArray(dates) || !dates.length) throw new Error('날짜를 하나 이상 선택하세요.');
  const clean = dates.map(assertValidDate_);
  loc = String(loc || '').trim();
  if (!loc) throw new Error('장소를 입력하세요.');
  note = String(note || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = openSessionSheet_();
    const now = new Date();
    clean.forEach(function (date) {
      // 날짜는 앞에 ' 를 붙여 텍스트로 저장 — 안 그러면 시트가 자동으로 날짜 타입으로 바꿔서
      // getDisplayValues()가 로캘 형식으로 돌려주기 때문에 'yyyy-MM-dd' 파싱이 깨진다(PIN·휴면종료일과 동일 이유).
      // G열(참여자)엔 개설자를 자동으로 첫 참여자로 기록(번개와 동일한 관례).
      sh.appendRow([Utilities.getUuid(), "'" + date, loc, note, requester, now, requester]);
    });
    const label = clean.map(function (d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }).join(', ');
    sendPush_('🧭 정기 오픈 세션 개설!', label + ' @ ' + loc +
      (note ? '\n' + note : '') + '\n' + requester + ' 님이 열었어요', {}); // 전체 푸시 (번개와 동일)
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

// 수정/삭제는 개설자 또는 관리자만 (canOpenSession_ 재검증 없음 — 개설 후 직책이 바뀌어도 본인 것은 계속 관리 가능)
function editOpenSession(id, date, loc, note, requester, authToken) {
  requester = verify_(requester, authToken);
  id = String(id || '').trim();
  date = assertValidDate_(date);
  loc = String(loc || '').trim();
  if (!loc) throw new Error('장소를 입력하세요.');
  note = String(note || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = openSessionSheet_();
    const row = findOpenSessionRow_(sh, id);
    if (!row) throw new Error('해당 오픈 세션을 찾을 수 없습니다.');
    const createdBy = sh.getRange(row, 5).getDisplayValue();
    if (createdBy !== requester && !isAdmin_(requester)) {
      throw new Error('본인이 연 오픈 세션만 수정할 수 있습니다.');
    }
    sh.getRange(row, 2, 1, 3).setValues([["'" + date, loc, note]]);
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

function deleteOpenSession(id, requester, authToken) {
  requester = verify_(requester, authToken);
  id = String(id || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = openSessionSheet_();
    const row = findOpenSessionRow_(sh, id);
    if (!row) throw new Error('해당 오픈 세션을 찾을 수 없습니다.');
    const createdBy = sh.getRange(row, 5).getDisplayValue();
    if (createdBy !== requester && !isAdmin_(requester)) {
      throw new Error('본인이 연 오픈 세션만 삭제할 수 있습니다.');
    }
    sh.deleteRow(row);
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

// 완료 처리 — 개설자 또는 관리자. 번개(completeFlash)와 동일하게 완료기록에 남기고 목록에서 제거.
// 참여자(G열)가 출석 통계(getStats)에 반영되도록 완료기록 F열(참여인원)에 그대로 옮겨 적는다.
function completeOpenSession(id, requester, authToken) {
  requester = verify_(requester, authToken);
  id = String(id || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = openSessionSheet_();
    const row = findOpenSessionRow_(sh, id);
    if (!row) throw new Error('해당 오픈 세션을 찾을 수 없습니다.');
    const vals = sh.getRange(row, 1, 1, 7).getDisplayValues()[0];
    const date = vals[1], loc = vals[2], createdBy = vals[4];
    if (createdBy !== requester && !isAdmin_(requester)) {
      throw new Error('본인이 연 오픈 세션만 완료 처리할 수 있습니다.');
    }
    const voters = String(vals[6] || '').split(',').map(function (n) { return n.trim(); }).filter(Boolean);
    const info = dateInfo_(date, String(date || '').slice(0, 7));
    logCompletion_('오픈세션', info ? info.ym : '', date, loc, voters, requester);
    sh.deleteRow(row);
    return getOpenSessions();
  } finally {
    lock.releaseLock();
  }
}

// 참여의사 토글 — 번개(toggleVote)와 동일하게 로그인한 누구나
function toggleOpenSessionVote(id, voter, authToken) {
  voter = verify_(voter, authToken);
  id = String(id || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = openSessionSheet_();
    const row = findOpenSessionRow_(sh, id);
    if (!row) throw new Error('해당 오픈 세션을 찾을 수 없습니다.');
    let voters = String(sh.getRange(row, 7).getDisplayValue() || '')
      .split(',').map(function (n) { return n.trim(); }).filter(Boolean);
    voters = voters.indexOf(voter) > -1
      ? voters.filter(function (v) { return v !== voter; })
      : voters.concat(voter);
    sh.getRange(row, 7).setValue(voters.join(', '));
    return { id: id, voters: voters };
  } finally {
    lock.releaseLock();
  }
}

// 관리자 전용: 오픈 세션 개설 가능 직책 목록 설정
function setOpenSessionRoles(roles, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 개설 가능 직책을 설정할 수 있습니다.');
  if (!Array.isArray(roles)) throw new Error('직책 배열이 필요합니다.');
  const clean = roles.filter(function (r) { return ROLES.indexOf(r) > -1; });
  if (!clean.length) throw new Error('최소 1개 직책을 선택하세요.');
  setOpenSessionRoles_(clean);
  return getOpenSessions();
}
