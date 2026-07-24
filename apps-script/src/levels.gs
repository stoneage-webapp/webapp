/**
 * 석기시대 부족 웹앱 — levels.gs
 * 레벨(난이도)별 완등 기록 + 순위.
 *
 *  - 레벨 목록: Script Property 'levels' (JSON 배열, **낮은 → 높은 순**). 관리자가 앱에서 설정(setLevels).
 *    배열의 순서(index)가 곧 난이도다 — 마지막 원소가 가장 어려운 레벨.
 *  - 완등 횟수: '레벨완등' 시트 (행=이름, 열=레벨). '인증현황' 시트와 같은 "열=속성, 행=이름" 방식.
 *    셀 값은 정수 완등 수(0/빈칸=없음). 열은 레벨 **이름**으로 매칭하므로 물리적 열 순서는 무관하다.
 *  - 순위(getLevelBoard): **최고 완등 레벨 우선**(레벨 순서 기준) → 동점은 그 레벨 완등 수 → 총 완등 수 → 이름.
 *
 * 기록/설정은 관리자만(setLevels/setLevelRecord). 순위 조회(getLevelBoard)는 공개 — 로그인 화면처럼 이름은 이미 공개.
 * 이름을 키로 쓰므로 부족원 삭제/개명 시 과거 레벨 기록은 이전 이름으로 남을 수 있다(members.gs 와 동일 원칙).
 */

function getLevels_() {
  const v = PropertiesService.getScriptProperties().getProperty('levels');
  try { const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

// '레벨완등' 시트 확보 (없으면 생성, A1='이름' 헤더 보장)
function levelSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.levels);
  if (!sh) sh = s.insertSheet(CONFIG.SHEETS.levels);
  if (!String(sh.getRange(1, 1).getValue()).trim()) sh.getRange(1, 1).setValue('이름');
  return sh;
}

// 헤더(1행)에서 레벨명 → 열번호(1-based) 맵. B열부터가 레벨.
function levelColMap_(sh) {
  const map = {};
  const lastCol = sh.getLastColumn();
  if (lastCol >= 2) {
    const hdr = sh.getRange(1, 2, 1, lastCol - 1).getDisplayValues()[0];
    for (let i = 0; i < hdr.length; i++) {
      const n = String(hdr[i]).trim();
      if (n) map[n] = i + 2;
    }
  }
  return map;
}

// 현재 레벨들에 대응하는 열이 없으면 오른쪽 끝에 추가. 반환: 레벨명 → 열번호
function ensureLevelColumns_(sh, levels) {
  const map = levelColMap_(sh);
  levels.forEach(function (lv) {
    if (!map[lv]) {
      const col = sh.getLastColumn() + 1;
      sh.getRange(1, col).setValue(lv);
      map[lv] = col;
    }
  });
  return map;
}

// 이름 → 행번호(1-based). 없고 create=true 면 새 행 추가.
function levelRowOf_(sh, name, create) {
  const last = sh.getLastRow();
  if (last >= 2) {
    const names = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (let i = 0; i < names.length; i++) {
      if (String(names[i][0]).trim() === name) return i + 2;
    }
  }
  if (!create) return 0;
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1).setValue(name);
  return row;
}

/* ---------- 순위 조회 (공개) ----------
 * 로스터(부족원) 전원 포함 — 기록 없는 사람은 rank=null, total=0 으로 맨 뒤.
 * 반환: { levels:[...순서], rows:[{ name, counts:{레벨:수}, topLevel, topIdx, topCount, total, rank }] }
 */
function getLevelBoard() {
  const levels = getLevels_();
  const s = ss_();
  const roster = splitBySupport_(s).all.map(function (m) { return m.name; });

  // 완등 시트 → { 이름: { 레벨: 수 } }
  const counts = {};
  const sh = s.getSheetByName(CONFIG.SHEETS.levels);
  if (sh && sh.getLastRow() > 1 && sh.getLastColumn() >= 2) {
    const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    const hdr = vals[0];
    for (let r = 1; r < vals.length; r++) {
      const nm = String(vals[r][0]).trim();
      if (!nm) continue;
      const c = {};
      for (let col = 1; col < hdr.length; col++) {
        const lv = String(hdr[col]).trim();
        const n = parseInt(vals[r][col], 10);
        if (lv && n > 0) c[lv] = n;
      }
      counts[nm] = c;
    }
  }

  const rows = roster.map(function (name) {
    const raw = counts[name] || {};
    const c = {};                 // 현재 레벨 목록에 있는 것만 (삭제된 레벨은 집계/표시 제외)
    let topIdx = -1, total = 0;
    levels.forEach(function (lv, i) {
      const n = raw[lv] || 0;
      if (n > 0) { c[lv] = n; total += n; if (i > topIdx) topIdx = i; }
    });
    const topLevel = topIdx >= 0 ? levels[topIdx] : '';
    return { name: name, counts: c, topLevel: topLevel, topIdx: topIdx,
             topCount: topLevel ? (c[topLevel] || 0) : 0, total: total };
  });

  // 최고레벨 desc → 그 레벨 완등수 desc → 총완등 desc → 이름 asc
  rows.sort(function (a, b) {
    if (b.topIdx !== a.topIdx) return b.topIdx - a.topIdx;
    if (b.topCount !== a.topCount) return b.topCount - a.topCount;
    if (b.total !== a.total) return b.total - a.total;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  // 순위 부여 (동일 키 = 공동 순위). 기록 없는 사람은 rank=null.
  let rank = 0, shown = 0, prevKey = null;
  rows.forEach(function (r) {
    if (r.topIdx < 0 && r.total === 0) { r.rank = null; return; }
    shown++;
    const key = r.topIdx + '|' + r.topCount + '|' + r.total;
    if (key !== prevKey) { rank = shown; prevKey = key; }
    r.rank = rank;
  });

  return { levels: levels, rows: rows };
}

/* ---------- 레벨 목록 설정 (관리자) ---------- */
function setLevels(levels, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 레벨을 설정할 수 있습니다.');
  if (!Array.isArray(levels)) throw new Error('레벨 배열이 필요합니다.');
  const clean = [];
  const seen = {};
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

/* ---------- 한 구성원의 레벨별 완등 수 기록 (관리자) ----------
 * counts = { 레벨명: 정수 } — 현재 레벨 목록에 있는 항목만 반영. 음수/비정수는 0 처리.
 */
function setLevelRecord(name, counts, requester, authToken) {
  requester = verify_(requester, authToken);
  if (!isAdmin_(requester)) throw new Error('관리자만 완등 기록을 수정할 수 있습니다.');
  name = String(name || '').trim();
  if (!name) throw new Error('대상 이름이 없습니다.');
  const roster = splitBySupport_(ss_()).all.map(function (m) { return m.name; });
  if (roster.indexOf(name) < 0) throw new Error('명단에 없는 이름입니다: ' + name);
  const levels = getLevels_();
  if (!levels.length) throw new Error('먼저 레벨을 설정하세요.');
  counts = (counts && typeof counts === 'object') ? counts : {};
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = levelSheet_();
    const colMap = ensureLevelColumns_(sh, levels);
    const row = levelRowOf_(sh, name, true);
    levels.forEach(function (lv) {
      let n = parseInt(counts[lv], 10);
      if (isNaN(n) || n < 0) n = 0;
      sh.getRange(row, colMap[lv]).setValue(n || ''); // 0 은 빈칸으로 (시트 가독성)
    });
  } finally {
    lock.releaseLock();
  }
  return getLevelBoard();
}
