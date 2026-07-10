/**
 * 석기시대 부족 웹앱 — votes.gs
 * 정기공격/자연재해 투표 · 번개 · 일정 확정 · 마감 판정.
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 번개(자연재해) 등록자 관리 (삭제 권한용) ---------- */
function getFlashOwners_() {
  const v = PropertiesService.getScriptProperties().getProperty('flash_owners');
  return v ? JSON.parse(v) : {};
}
function setFlashOwners_(obj) {
  PropertiesService.getScriptProperties().setProperty('flash_owners', JSON.stringify(obj));
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

// 번개 삭제: 등록자 또는 관리자만
function deleteFlash(dateText, requester, authToken) {
  requester = verify_(requester, authToken);
  const owners = getFlashOwners_();
  const owner = owners[dateText];
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
    .map(function(r) { return { date: r[0], voters: r.slice(1).filter(String) }; });
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
    groups[month].push({ date: date, voters: vals[i].slice(3).filter(String) });
  }
  order.sort();
  return order.map(function(m) {
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
function confirmDate(month, dateText, loc, name, pin) {
  if (CONFIG.ADMINS.indexOf(name) < 0 || String(pin) !== String(CONFIG.ADMIN_PIN)) {
    throw new Error('확정 권한이 없습니다.');
  }
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
    confAll[month] = { date: dateText, loc: loc || '' };
    setRaidConfirmedAll_(confAll);
    sh.getRange(found + 1, 1, 1, Math.max(sh.getLastColumn(), 1)).setBackground('#3d2e1a');

    // 노션 캘린더 기록 (실패해도 확정은 진행)
    if (CONFIG.NOTION_TOKEN && CONFIG.NOTION_DB_ID) {
      const voters = vals[found].slice(3).filter(String); // D열~ 투표자
      try { addToNotion_(dateText, loc, voters); } catch (e) { Logger.log('Notion 기록 실패: ' + e); }
    }
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
