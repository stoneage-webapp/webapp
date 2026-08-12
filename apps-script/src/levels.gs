/**
 * 석기시대 부족 웹앱 — levels.gs
 * 레벨(난이도)별 완등 기록 + 순위. **분기(3개월) 시즌제.**
 *
 *  - 레벨 목록: Script Property 'levels' (시즌 무관, 전역). 낮은→높은 순.
 *  - 완등 횟수: '레벨완등' 시트 A=시즌, B=이름, C~=레벨. 셀 값=정수 완등 수(0/빈칸=없음).
 *  - 시즌: 분기(1~3=Q1, 4~6=Q2, 7~9=Q3, 10~12=Q4). 분기가 바뀌면 자연히 새 시즌(0부터), 지난 시즌 행은 보존.
 *  - 순위(getLevelBoard): 요청 시즌(기본=현재 분기) 안에서 최고 레벨 우선 → 그 레벨 완등수 → 총완등 → 이름.
 *
 * 순위 조회는 공개. 완등 기록은 본인(setMyLevelRecord)/관리자 정정(setLevelRecord), 레벨 목록 설정은 관리자(setLevels).
 * 구(舊)형식 시트(A=이름, 시즌 열 없음)는 levelSheet_()가 첫 쓰기 때 시즌 열을 삽입해 현재 시즌으로 스탬프.
 */

// 현재 분기 시즌 키 (예: '2026-Q3')
function currentSeason_() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const y = Utilities.formatDate(now, tz, 'yyyy');
  const m = Number(Utilities.formatDate(now, tz, 'MM'));
  return y + '-Q' + Math.ceil(m / 3);
}
// 시즌 키 → 라벨 (예: '2026 3분기')
function seasonLabel_(key) {
  const m = String(key || '').match(/^(\d{4})-Q([1-4])$/);
  return m ? (m[1] + ' ' + m[2] + '분기') : (key || '');
}

function getLevels_() {
  const v = PropertiesService.getScriptProperties().getProperty('levels');
  try { const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

// '레벨완등' 시트 확보 + 헤더(A=시즌, B=이름) 보장 + 구형식 자동 마이그레이션
function levelSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.levels);
  if (!sh) { sh = s.insertSheet(CONFIG.SHEETS.levels); sh.getRange(1, 1, 1, 2).setValues([['시즌', '이름']]); return sh; }
  const a1 = String(sh.getRange(1, 1).getValue()).trim();
  if (a1 === '이름') {
    // 구 형식(A=이름, B~=레벨) → 맨 앞에 시즌 열 삽입 후 기존 데이터를 현재 시즌으로 스탬프
    sh.insertColumnBefore(1);
    sh.getRange(1, 1).setValue('시즌');
    const last = sh.getLastRow();
    if (last >= 2) {
      const season = currentSeason_();
      const stamp = [];
      for (let i = 0; i < last - 1; i++) stamp.push([season]);
      sh.getRange(2, 1, stamp.length, 1).setValues(stamp);
    }
  } else if (a1 !== '시즌') {
    sh.getRange(1, 1, 1, 2).setValues([['시즌', '이름']]);
  }
  if (String(sh.getRange(1, 2).getValue()).trim() !== '이름') sh.getRange(1, 2).setValue('이름');
  return sh;
}

// 헤더에서 레벨명 → 열번호(1-based). C열(3)부터가 레벨.
function levelColMap_(sh) {
  const map = {};
  const lastCol = sh.getLastColumn();
  if (lastCol >= 3) {
    const hdr = sh.getRange(1, 3, 1, lastCol - 2).getDisplayValues()[0];
    for (let i = 0; i < hdr.length; i++) {
      const n = String(hdr[i]).trim();
      if (n) map[n] = i + 3;
    }
  }
  return map;
}

// 현재 레벨들에 대응하는 열이 없으면 오른쪽 끝에 추가 (최소 C열부터). 반환: 레벨명 → 열번호
function ensureLevelColumns_(sh, levels) {
  const map = levelColMap_(sh);
  levels.forEach(function (lv) {
    if (!map[lv]) {
      const col = Math.max(sh.getLastColumn(), 2) + 1;
      sh.getRange(1, col).setValue(lv);
      map[lv] = col;
    }
  });
  return map;
}

// (시즌, 이름) → 행번호. 없고 create=true 면 새 행 추가.
function levelRowOf_(sh, season, name, create) {
  const last = sh.getLastRow();
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, 2).getDisplayValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === season && String(vals[i][1]).trim() === name) return i + 2;
    }
  }
  if (!create) return 0;
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 2).setValues([[season, name]]);
  return row;
}

/* ---------- 순위 조회 (공개) ----------
 * season 미지정 시 현재 분기. 구형식 시트(시즌 열 없음)는 전 행을 요청 시즌으로 간주(마이그레이션 전 과도기).
 * 반환: { levels, rows:[{name,counts,topLevel,topIdx,topCount,total,rank}], season, seasonLabel }
 */
function getLevelBoard(season) {
  season = String(season || '').trim() || currentSeason_();
  const levels = getLevels_();
  const s = ss_();
  const roster = splitBySupport_(s).all.map(function (m) { return m.name; });

  const counts = {}; // 이름 → { 레벨: 수 }
  const seasonsSet = {}; seasonsSet[currentSeason_()] = true; // 드롭다운용 시즌 목록(항상 현재 포함)
  const sh = s.getSheetByName(CONFIG.SHEETS.levels);
  if (sh && sh.getLastRow() > 1 && sh.getLastColumn() >= 2) {
    const seasoned = String(sh.getRange(1, 1).getValue()).trim() === '시즌';
    const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    const hdr = vals[0];
    const nameCol = seasoned ? 1 : 0;       // B(시즌형) 또는 A(구형)
    const firstLevelCol = seasoned ? 2 : 1; // C 또는 B
    for (let r = 1; r < vals.length; r++) {
      if (seasoned) { const sv = String(vals[r][0]).trim(); if (/^\d{4}-Q[1-4]$/.test(sv)) seasonsSet[sv] = true; }
      if (seasoned && String(vals[r][0]).trim() !== season) continue; // 시즌 필터
      const nm = String(vals[r][nameCol]).trim();
      if (!nm) continue;
      const c = {};
      for (let col = firstLevelCol; col < hdr.length; col++) {
        const lv = String(hdr[col]).trim();
        const n = parseInt(vals[r][col], 10);
        if (lv && n > 0) c[lv] = n;
      }
      counts[nm] = c;
    }
  }

  const rows = roster.map(function (name) {
    const raw = counts[name] || {};
    const c = {};
    let topIdx = -1, total = 0;
    levels.forEach(function (lv, i) {
      const n = raw[lv] || 0;
      if (n > 0) { c[lv] = n; total += n; if (i > topIdx) topIdx = i; }
    });
    const topLevel = topIdx >= 0 ? levels[topIdx] : '';
    return { name: name, counts: c, topLevel: topLevel, topIdx: topIdx,
             topCount: topLevel ? (c[topLevel] || 0) : 0, total: total };
  });
  rows.sort(function (a, b) {
    if (b.topIdx !== a.topIdx) return b.topIdx - a.topIdx;
    if (b.topCount !== a.topCount) return b.topCount - a.topCount;
    if (b.total !== a.total) return b.total - a.total;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  let rank = 0, shown = 0, prevKey = null;
  rows.forEach(function (r) {
    if (r.topIdx < 0 && r.total === 0) { r.rank = null; return; }
    shown++;
    const key = r.topIdx + '|' + r.topCount + '|' + r.total;
    if (key !== prevKey) { rank = shown; prevKey = key; }
    r.rank = rank;
  });

  return { levels: levels, rows: rows, season: season, seasonLabel: seasonLabel_(season),
           seasons: Object.keys(seasonsSet).sort().reverse() }; // 최신 시즌 먼저
}

/* ---------- 레벨 목록 설정 (관리자) ---------- */
function setLevels(levels, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 레벨을 설정할 수 있습니다.');
  if (!Array.isArray(levels)) throw new Error('레벨 배열이 필요합니다.');
  const clean = []; const seen = {};
  levels.forEach(function (lv) {
    const n = String(lv).trim();
    if (!n) return;
    if (n.length > 12) throw new Error('레벨 이름은 12자 이내로: ' + n);
    if (seen[n]) throw new Error('레벨 이름이 중복돼요: ' + n);
    seen[n] = true; clean.push(n);
  });
  PropertiesService.getScriptProperties().setProperty('levels', JSON.stringify(clean));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { ensureLevelColumns_(levelSheet_(), clean); } finally { lock.releaseLock(); }
  return getLevelBoard();
}

/* ---------- 한 구성원의 레벨별 완등 수 기록 (현재 시즌) ----------
 * counts = { 레벨명: 정수 }. 권한 검증은 호출부에서 완료 가정.
 */
function writeLevelRecord_(name, counts) {
  name = String(name || '').trim();
  if (!name) throw new Error('대상 이름이 없습니다.');
  const roster = splitBySupport_(ss_()).all.map(function (m) { return m.name; });
  if (roster.indexOf(name) < 0) throw new Error('명단에 없는 이름입니다: ' + name);
  const levels = getLevels_();
  if (!levels.length) throw new Error('아직 레벨이 설정되지 않았어요. (관리자에게 문의)');
  counts = (counts && typeof counts === 'object') ? counts : {};
  const season = currentSeason_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = levelSheet_();
    const colMap = ensureLevelColumns_(sh, levels);
    const row = levelRowOf_(sh, season, name, true);
    levels.forEach(function (lv) {
      let n = parseInt(counts[lv], 10);
      if (isNaN(n) || n < 0) n = 0;
      sh.getRange(row, colMap[lv]).setValue(n || ''); // 0 은 빈칸으로
    });
  } finally {
    lock.releaseLock();
  }
  return getLevelBoard(season);
}

// 관리자: 아무 구성원의 완등 기록 정정
function setLevelRecord(name, counts, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 다른 구성원의 완등 기록을 수정할 수 있습니다.');
  return writeLevelRecord_(name, counts);
}
// 본인: 자기 완등 기록만 (토큰으로 본인 확인)
function setMyLevelRecord(counts, name, authToken) {
  name = verify_(name, authToken);
  return writeLevelRecord_(name, counts);
}
