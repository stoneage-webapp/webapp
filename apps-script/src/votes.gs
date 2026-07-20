/**
 * 석기시대 부족 웹앱 — votes.gs
 * 정기공격/자연재해 투표 · 번개 · 일정 확정 · 마감 판정.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 번개(자연재해) 등록자 관리 (수정/완료/삭제 권한용) ---------- */
function getFlashOwners_() {
  const v = PropertiesService.getScriptProperties().getProperty('flash_owners');
  return v ? JSON.parse(v) : {};
}
function setFlashOwners_(obj) {
  PropertiesService.getScriptProperties().setProperty('flash_owners', JSON.stringify(obj));
}

// 번개 개설자 판정: flash_owners 기록이 있으면 그 값, 없으면(마이그레이션 이전 등 기록이 없는 번개)
// 자연재해 시트 B열(첫 투표자=개설자, docs/sheets.md 참고)로 폴백한다.
function flashOwnerOf_(dateText) {
  const owners = getFlashOwners_();
  if (owners[dateText]) return owners[dateText];
  const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
  if (!sh) return '';
  const vals = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === dateText) return vals[i][1] ? String(vals[i][1]).trim() : '';
  }
  return '';
}

// 번개 열기: 자연재해 시트 A열에 새 행 추가 (등록자 기록)
function addFlash(dateText, loc, creator, authToken) {
  creator = verify_(creator, authToken);
  dateText = String(dateText || '').trim();
  loc = String(loc || '').trim();
  if (!dateText) throw new Error('날짜를 입력하세요.');
  if (!loc) throw new Error('위치를 입력하세요.');
  const label = dateText + ' @ ' + loc;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === label) throw new Error('이미 같은 번개가 있습니다.');
    }
    sh.appendRow([label, creator]); // A=라벨, B=등록자(첫 참여자 겸)
    const owners = getFlashOwners_();
    owners[label] = creator;
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

// 번개 삭제: 개설자 또는 관리자만
function deleteFlash(dateText, requester, authToken) {
  requester = verify_(requester, authToken);
  const owner = flashOwnerOf_(dateText);
  if (owner !== requester && CONFIG.ADMINS.indexOf(requester) < 0) {
    throw new Error('본인이 연 번개만 취소할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === dateText) {
        sh.deleteRow(i + 1);
        break;
      }
    }
    const owners = getFlashOwners_();
    delete owners[dateText];
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

function readVotes_(s, sheetName) {
  const sh = s.getSheetByName(sheetName);
  if (!sh) return [];
  const vals = sh.getDataRange().getDisplayValues();
  return vals.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      // 번개 라벨 = '날짜 @ 위치' (addFlash 참고). date는 투표 키로 원본 유지.
      const label = String(r[0]);
      const parts = label.split(' @ ');
      return {
        date: r[0],
        loc: parts.length > 1 ? parts.slice(1).join(' @ ') : '',
        dateInfo: dateInfo_(parts[0], ''),   // 표준 표기 (파싱 실패 시 null → 원본 라벨 표시)
        voters: r.slice(1).filter(String)
      };
    });
}

/* ---------- 날짜 라벨 표준화 ----------
 * '7/16', '7/16(수) 20:00', '2026-07-16', '7월 16일' 등 → YYYY-MM-DD (요일) [HH:mm]
 * monthHint('2026-07'): 연도 없는 라벨의 연도 보정 (정기공격 월 그룹). 없으면 올해로 추정.
 * 반환: { iso, ym, weekday, time|null, display } 또는 파싱 실패 시 null (호출부는 원본 라벨 폴백)
 */
const WEEKDAY_KO_ = ['일', '월', '화', '수', '목', '금', '토'];

function dateInfo_(label, monthHint) {
  if (!label) return null;
  label = String(label).trim();
  let y, mo, da;
  // 1) 연도 포함: 2026-07-16 / 2026.7.16 / 2026년 7월 16일
  let m = label.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; }
  else {
    // 2) 월/일만: 7/16 · 7월 16일 · 7-16 (콜론(:)은 시각이므로 제외됨)
    m = label.match(/(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (!m) return null;
    mo = +m[1]; da = +m[2];
    y = (monthHint && /^\d{4}-\d{2}$/.test(monthHint)) ? +monthHint.slice(0, 4) : new Date().getFullYear();
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const d = new Date(y, mo - 1, da);
  if (d.getMonth() !== mo - 1) return null; // 2/30 같은 무효 날짜
  const iso = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2);
  const tm = label.match(/(\d{1,2}):(\d{2})/);
  const time = tm ? ('0' + tm[1]).slice(-2) + ':' + tm[2] : null;
  const weekday = WEEKDAY_KO_[d.getDay()];
  return {
    iso: iso,
    ym: iso.slice(0, 7),
    weekday: weekday,
    time: time,
    display: iso + ' (' + weekday + ')' + (time ? ' ' + time : '')
  };
}

/* ---------- 투표 통합 조회 (월별 필터) ----------
 * month('2026-07', 선택): 정기공격은 월 그룹, 번개는 dateInfo.ym 기준으로 필터.
 * months: 존재하는 모든 월 목록 (프론트 필터 드롭다운용).
 */
function getVotes(month) {
  const s = ss_();
  let raidMonths = readRaidByMonth_(s);
  let disaster = readVotes_(s, CONFIG.SHEETS.disaster);
  const seen = {};
  raidMonths.forEach(function (r) { seen[r.month] = true; });
  disaster.forEach(function (d) { if (d.dateInfo) seen[d.dateInfo.ym] = true; });
  const months = Object.keys(seen).sort();
  month = String(month || '').trim();
  if (month) {
    raidMonths = raidMonths.filter(function (r) { return r.month === month; });
    disaster = disaster.filter(function (d) { return d.dateInfo && d.dateInfo.ym === month; });
  }
  return {
    months: months,
    raidMonths: raidMonths,
    disaster: disaster,
    confirmed: getConfirmed_(),
    flashOwners: getFlashOwners_()
  };
}

/* ---------- 정기공격: 월별 투표 읽기 ----------
 * 시트: A=대상월(2026-07), B=날짜후보, C=마감일(2026-07-05), D~=투표자
 * 반환: [{ month, deadline, closed, confirmed, options:[{date,voters}] }, ...]
 */
function readRaidByMonth_(s) {
  const sh = s.getSheetByName(CONFIG.SHEETS.raid);
  if (!sh) return [];
  const vals = sh.getDataRange().getDisplayValues();
  const confAll = getRaidConfirmedAll_();
  const groups = {}; const deadlines = {}; const order = [];
  for (let i = 1; i < vals.length; i++) {
    const month = String(vals[i][0]).trim();
    const date = String(vals[i][1]).trim();
    if (!month || !date) continue;
    if (!groups[month]) { groups[month] = []; order.push(month); }
    if (vals[i][2] && !deadlines[month]) deadlines[month] = String(vals[i][2]).trim();
    groups[month].push({
      date: date,
      dateInfo: dateInfo_(date, month),  // 표준 표기 (월 그룹으로 연도 보정)
      voters: vals[i].slice(3).filter(String)
    });
  }
  order.sort();
  const done = getCompletedRaidMonths_(); // 완료 처리된 월은 목록에서 제외 (#완료처리)
  return order.filter(function (m) { return !done[m]; }).map(function(m) {
    const dl = deadlines[m] || '';
    return {
      month: m, deadline: dl, closed: isPastDeadline_(dl),
      confirmed: confAll[m] || null, options: groups[m]
    };
  });
}

/* ---------- 투표 마감 (번개 시트 B1 셀에만 사용) ---------- */

function getVoteMeta_(sh) {
  const dl = sh ? sh.getRange('B1').getDisplayValue() : '';
  return { deadline: dl, closed: isPastDeadline_(dl) };
}

function isPastDeadline_(txt) {
  if (!txt) return false;
  const m = String(txt).match(/(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
  if (!m) return false;
  const end = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  return new Date() > end;
}

/* ---------- 일정 확정 (정기공격은 월별) ---------- */

// 정기공격 월별 확정 저장소: { '2026-07': {date,loc}, ... }
function getRaidConfirmedAll_() {
  const v = PropertiesService.getScriptProperties().getProperty('confirmed_raid_months');
  return v ? JSON.parse(v) : {};
}
function setRaidConfirmedAll_(obj) {
  PropertiesService.getScriptProperties().setProperty('confirmed_raid_months', JSON.stringify(obj));
}

function getConfirmed_() {
  const p = PropertiesService.getScriptProperties();
  function parse(key) {
    const v = p.getProperty(key);
    if (!v) return null;
    try {
      const o = JSON.parse(v);
      return o && o.date ? o : { date: v, loc: '' };
    } catch (e) {
      return { date: v, loc: '' };
    }
  }
  return { disaster: parse('confirmed_disaster') };
}

// dateText가 빈 값이면 확정 취소 (투표 재개). loc = 확정 위치. 확정은 정기공격만 가능
// 정기공격 월별 확정. dateText 빈값이면 해당 월 확정 취소. month = '2026-07'
function confirmDate(month, dateText, loc, name, pin, note) {
  assertNotLocked_('admin'); // 관리자 PIN도 무차별 대입 방어
  if (CONFIG.ADMINS.indexOf(name) < 0 || String(pin) !== String(getAdminPin_())) {
    recordPinFail_('admin');
    throw new Error('확정 권한이 없습니다.');
  }
  clearPinFail_('admin');
  month = String(month || '').trim();
  if (!month) throw new Error('대상 월이 없습니다.');

  const sh = ss_().getSheetByName(CONFIG.SHEETS.raid);
  const confAll = getRaidConfirmedAll_();
  const vals = sh.getDataRange().getDisplayValues();

  // 해당 월 행들의 배경 초기화 (A=월, B=날짜)
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === month) {
      sh.getRange(i + 1, 1, 1, Math.max(sh.getLastColumn(), 1)).setBackground(null);
    }
  }

  if (!dateText) {
    delete confAll[month];
    setRaidConfirmedAll_(confAll);
  } else {
    let found = -1;
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === month && String(vals[i][1]).trim() === dateText) {
        found = i; break;
      }
    }
    if (found < 0) throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
    confAll[month] = { date: dateText, loc: loc || '', note: String(note || '').trim() };
    setRaidConfirmedAll_(confAll);
    sh.getRange(found + 1, 1, 1, Math.max(sh.getLastColumn(), 1)).setBackground('#3d2e1a');
  }
  return readRaidByMonth_(ss_());
}

/* ---------- 투표 (토글) ----------
 * 정기공격: toggleVote('raid', dateText, voter, token, month)
 * 자연재해: toggleVote('disaster', dateText, voter, token)
 */
function toggleVote(category, dateText, voter, token, month) {
  voter = verify_(voter, token);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (category === 'raid') {
      // 해당 월이 확정됐으면 그 월만 투표 마감
      const confAll = getRaidConfirmedAll_();
      if (confAll[month]) throw new Error(month + ' 모임이 확정되어 투표가 마감되었습니다.');
      const sh = ss_().getSheetByName(CONFIG.SHEETS.raid);
      const vals = sh.getDataRange().getDisplayValues();
      // 해당 월 마감일 확인 (C열)
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === month && vals[i][2]) {
          if (isPastDeadline_(String(vals[i][2]).trim())) throw new Error('투표가 마감되었습니다.');
          break;
        }
      }
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === month && String(vals[i][1]).trim() === dateText) {
          let voters = vals[i].slice(3).filter(String); // D열~
          voters = voters.indexOf(voter) > -1
            ? voters.filter(function(v) { return v !== voter; })
            : voters.concat(voter);
          const width = Math.max(sh.getLastColumn() - 3, voters.length, 1);
          sh.getRange(i + 1, 4, 1, width)
            .setValues([voters.concat(new Array(width - voters.length).fill(''))]);
          return { date: dateText, voters: voters };
        }
      }
      throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
    } else {
      // 자연재해(번개): A=날짜, B~=투표자
      const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
      const vals = sh.getDataRange().getDisplayValues();
      for (let i = 1; i < vals.length; i++) {
        if (vals[i][0] === dateText) {
          let voters = vals[i].slice(1).filter(String);
          voters = voters.indexOf(voter) > -1
            ? voters.filter(function(v) { return v !== voter; })
            : voters.concat(voter);
          const width = Math.max(sh.getLastColumn() - 1, voters.length, 1);
          sh.getRange(i + 1, 2, 1, width)
            .setValues([voters.concat(new Array(width - voters.length).fill(''))]);
          return { date: dateText, voters: voters };
        }
      }
      throw new Error('해당 일자를 찾을 수 없습니다: ' + dateText);
    }
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 자연재해(번개) 수정 ----------
 * 날짜/위치 라벨만 변경 (투표자는 해당 행 그대로 유지). 등록자 또는 관리자만 가능.
 */
function editFlash(dateText, newDate, newLoc, requester, authToken) {
  requester = verify_(requester, authToken);
  const owner = flashOwnerOf_(dateText);
  if (owner !== requester && !isAdmin_(requester)) {
    throw new Error('본인이 연 번개만 수정할 수 있습니다.');
  }
  newDate = String(newDate || '').trim();
  newLoc = String(newLoc || '').trim();
  if (!newDate) throw new Error('날짜를 입력하세요.');
  if (!newLoc) throw new Error('위치를 입력하세요.');
  const newLabel = newDate + ' @ ' + newLoc;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    let found = -1;
    for (let i = 1; i < vals.length; i++) {
      const label = String(vals[i][0]).trim();
      if (label === dateText) found = i;
      else if (label === newLabel) throw new Error('이미 같은 번개가 있습니다.');
    }
    if (found < 0) throw new Error('해당 번개를 찾을 수 없습니다.');
    if (newLabel !== dateText) {
      sh.getRange(found + 1, 1).setValue(newLabel);
      // B열 폴백으로 알아낸 개설자도 이번에 flash_owners에 정식 기록해둔다(다음부터는 폴백 없이 바로 조회).
      if (owner) {
        const owners = getFlashOwners_();
        delete owners[dateText];
        owners[newLabel] = owner;
        setFlashOwners_(owners);
      }
    }
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 완료 처리 (정기공격/자연재해 종료) ----------
 * 완료하면 목록(UI)에서 사라지고 '완료기록' 시트에 남는다.
 * - 정기공격: 확정된 월(완료) 또는 확정 없이 마감된 월(모임 없음)만 가능. 후보 행은 사람이 등록한 것이라 시트는 그대로 두고,
 *   Script Properties(completed_raid_months)에 완료 플래그만 남겨 목록에서 제외한다(readRaidByMonth_).
 * - 자연재해: 시트 전체를 앱이 관리하므로 취소(deleteFlash)와 동일하게 행 자체를 제거한다.
 */
function getCompletedRaidMonths_() {
  const v = PropertiesService.getScriptProperties().getProperty('completed_raid_months');
  return v ? JSON.parse(v) : {};
}
function setCompletedRaidMonths_(obj) {
  PropertiesService.getScriptProperties().setProperty('completed_raid_months', JSON.stringify(obj));
}

function completionLogSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.completion);
  if (!sh) sh = s.insertSheet(CONFIG.SHEETS.completion);
  if (sh.getLastRow() === 0) sh.appendRow(['처리일시', '종류', '월', '날짜', '위치', '참여인원', '처리자']);
  return sh;
}
function logCompletion_(kind, month, dateLabel, loc, voters, requester) {
  completionLogSheet_().appendRow([
    new Date(), kind, month || '', dateLabel || '', loc || '', (voters || []).join(', '), requester
  ]);
}

// 완료기록 최근 목록 (더보기 탭 노출용, 공개 GET — getHallArchive와 동일한 성격의 조회)
function getCompletionLog(limit) {
  limit = limit || 10;
  const sh = ss_().getSheetByName(CONFIG.SHEETS.completion);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const vals = sh.getDataRange().getDisplayValues();
  const items = [];
  for (let i = vals.length - 1; i >= 1 && items.length < limit; i--) {
    const r = vals[i]; // [처리일시, 종류, 월, 날짜, 위치, 참여인원, 처리자]
    if (!r[0]) continue;
    items.push({ when: r[0], kind: r[1], month: r[2], date: r[3], loc: r[4], people: r[5], by: r[6] });
  }
  return { items: items };
}

// 정기공격 월 완료 처리 — 관리자 전용.
// 확정된 월이면 "완료"(모임 진행)로, 미확정이지만 투표가 마감된 채 방치된 월이면 "모임 없음"으로 종료한다.
function completeRaid(month, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 완료 처리할 수 있습니다.');
  month = String(month || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const g = readRaidByMonth_(ss_()).find(function (x) { return x.month === month; });
    if (!g) throw new Error('해당 월을 찾을 수 없습니다.');
    if (g.confirmed) {
      const opt = g.options.find(function (x) { return x.date === g.confirmed.date; }) || { voters: [] };
      logCompletion_('정기공격', month, g.confirmed.date, g.confirmed.loc, opt.voters, requester);
    } else if (g.closed) {
      logCompletion_('정기공격', month, '(모임 없음)', '', [], requester);
    } else {
      throw new Error('확정되었거나 투표가 마감된 월만 완료 처리할 수 있습니다.');
    }
    const done = getCompletedRaidMonths_();
    done[month] = { at: new Date().toISOString(), by: requester };
    setCompletedRaidMonths_(done);
    return readRaidByMonth_(ss_());
  } finally {
    lock.releaseLock();
  }
}

// 이번 달 완료 처리된 모임의 참여자였는데 아직 이번 달 사진 인증을 안 한 사람인지 — 로그인 시 개인화 리마인드용.
// 본인 여부만 반환(다른 사람 인증 현황은 노출하지 않음).
function needsCertNudge_(name) {
  name = String(name || '').trim();
  if (!name) return false;
  const s = ss_();
  const cert = getCertified_(s);
  if (cert.map[name]) return false; // 이미 인증했으면 알림 불필요
  const sh = s.getSheetByName(CONFIG.SHEETS.completion);
  if (!sh || sh.getLastRow() < 2) return false;
  const vals = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][2]).trim() !== cert.ym) continue; // C=월
    const people = String(vals[i][5] || '').split(',').map(function (n) { return n.trim(); }); // F=참여인원
    if (people.indexOf(name) > -1) return true;
  }
  return false;
}

// 자연재해(번개) 완료 처리 — 등록자 또는 관리자. 기록 후 행 제거(취소와 동일한 정리).
function completeFlash(dateText, requester, authToken) {
  requester = verify_(requester, authToken);
  const owner = flashOwnerOf_(dateText);
  if (owner !== requester && !isAdmin_(requester)) {
    throw new Error('본인이 연 번개만 완료 처리할 수 있습니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.disaster);
    const vals = sh.getDataRange().getDisplayValues();
    let found = -1, voters = [];
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === dateText) { found = i; voters = vals[i].slice(1).filter(String); break; }
    }
    if (found < 0) throw new Error('해당 번개를 찾을 수 없습니다.');
    const parts = dateText.split(' @ ');
    const info = dateInfo_(parts[0], '');
    logCompletion_('자연재해', info ? info.ym : '', parts[0], parts.length > 1 ? parts.slice(1).join(' @ ') : '', voters, requester);
    sh.deleteRow(found + 1);
    const owners = getFlashOwners_();
    delete owners[dateText];
    setFlashOwners_(owners);
    return readVotes_(ss_(), CONFIG.SHEETS.disaster);
  } finally {
    lock.releaseLock();
  }
}
