/**
 * 석기시대 부족 웹앱 — budget.gs
 * 부족 예산: **정산 적립**(자동) + **사용 이력**(수동). 조회·기록은 정산 담당자/관리자만(canSettle_).
 *
 * '예산' 시트 — 앱이 자동 생성/관리:
 * | A 일시 | B 구분(적립/사용) | C 금액 | D 내용 | E 처리자 | F 월 |
 *  - 적립: 정산 실행 시 자동 1행. 금액 = 정산된 인원 × CONFIG.BUDGET_PER_PERSON(기본 5,000원).
 *          F열(월)이 중복 방지 키 — 같은 달을 다시 정산하면 그 행을 **갱신**한다(중복 적립 없음).
 *  - 사용: 담당자가 직접 등록(addExpense). 잔액 = 적립 합계 − 사용 합계.
 */

function budgetSheet_() {
  const s = ss_();
  let sh = s.getSheetByName(CONFIG.SHEETS.budget);
  if (!sh) {
    sh = s.insertSheet(CONFIG.SHEETS.budget);
    sh.appendRow(['일시', '구분', '금액', '내용', '처리자', '월']);
  }
  if (sh.getLastRow() === 0) sh.appendRow(['일시', '구분', '금액', '내용', '처리자', '월']);
  return sh;
}

// 숫자만 뽑기 (표시값에 콤마·원 등이 섞여도 안전)
function toAmount_(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/* ---------- 조회 (정산 담당자/관리자) ----------
 * 반환: { balance, credit, spent, perPerson, items:[{when,kind,amount,note,by,month,row}] } — 최신순
 */
function getBudget(name, authToken) {
  name = verify_(name, authToken);
  if (!canSettle_(name)) throw new Error('정산 담당자만 예산을 볼 수 있습니다.');
  const sh = ss_().getSheetByName(CONFIG.SHEETS.budget);
  const items = [];
  let credit = 0, spent = 0;
  if (sh && sh.getLastRow() > 1) {
    const vals = sh.getRange(1, 1, sh.getLastRow(), 6).getDisplayValues();
    for (let i = vals.length - 1; i >= 1; i--) {
      const r = vals[i];
      const kind = String(r[1]).trim();
      if (!kind) continue;
      const amount = toAmount_(r[2]);
      if (kind === '적립') credit += amount; else spent += amount;
      items.push({ when: r[0], kind: kind, amount: amount, note: r[3], by: r[4], month: r[5], row: i + 1 });
    }
  }
  return { balance: credit - spent, credit: credit, spent: spent,
           perPerson: CONFIG.BUDGET_PER_PERSON, items: items };
}

/* ---------- 정산 적립 (settleMonth 가 호출) ----------
 * 같은 달 적립 행이 있으면 금액/내용만 갱신 → 재정산해도 중복 적립되지 않는다.
 */
function creditSettlement_(ym, people, by) {
  try {
    const per = CONFIG.BUDGET_PER_PERSON;
    const amount = per * (Number(people) || 0);
    const note = ym + ' 정산 적립 (' + (Number(people) || 0) + '명 × ' + per.toLocaleString() + '원)';
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sh = budgetSheet_();
      const last = sh.getLastRow();
      let found = 0;
      if (last > 1) {
        const vals = sh.getRange(2, 2, last - 1, 5).getDisplayValues(); // B~F
        for (let i = 0; i < vals.length; i++) {
          if (String(vals[i][0]).trim() === '적립' && String(vals[i][4]).trim() === ym) { found = i + 2; break; }
        }
      }
      if (found) {
        sh.getRange(found, 1).setValue(new Date());
        sh.getRange(found, 3).setValue(amount);
        sh.getRange(found, 4).setValue(note);
        sh.getRange(found, 5).setValue(by || '');
      } else {
        sh.appendRow([new Date(), '적립', amount, note, by || '', ym]);
      }
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    logError_('creditSettlement', (e && e.message) || String(e)); // 적립 실패가 정산을 막지 않도록
  }
}

/* ---------- 사용 등록 (정산 담당자/관리자) ---------- */
function addExpense(amount, note, name, authToken) {
  name = verify_(name, authToken);
  if (!canSettle_(name)) throw new Error('정산 담당자만 예산을 사용할 수 있습니다.');
  amount = toAmount_(amount);
  if (amount <= 0) throw new Error('금액을 올바르게 입력하세요.');
  note = String(note || '').trim();
  if (!note) throw new Error('사용 내용을 입력하세요.');
  if (note.length > 200) throw new Error('내용은 200자 이내로 작성하세요.');
  budgetSheet_().appendRow([new Date(), '사용', amount, note, name, '']);
  return getBudget(name, authToken);
}

/* ---------- 항목 삭제 (정산 담당자/관리자). when 대조로 행 밀림 오삭제 방지 ---------- */
function deleteBudgetItem(row, when, name, authToken) {
  name = verify_(name, authToken);
  if (!canSettle_(name)) throw new Error('정산 담당자만 예산을 수정할 수 있습니다.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEETS.budget);
    row = Number(row);
    if (!sh || !row || row < 2 || row > sh.getLastRow()) throw new Error('해당 항목을 찾을 수 없습니다.');
    if (String(sh.getRange(row, 1).getDisplayValue()) !== String(when)) {
      throw new Error('목록이 갱신되었습니다. 새로고침 후 다시 시도해주세요.');
    }
    sh.deleteRow(row);
  } finally {
    lock.releaseLock();
  }
  return getBudget(name, authToken);
}
