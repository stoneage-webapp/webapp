/**
 * 석기시대 부족 웹앱 — notion.gs
 * 정기모임 확정 시 노션 캘린더 기록 (Phase 6에서 제거 예정).
 * (로직은 원본 v3.0.2/Code.gs에서 그대로 이전. GAS는 전역 스코프 공유.)
 */

/* ---------- 노션 캘린더 기록 ----------
 * 제목 = "⚔️ 정기모임 @위치 (참여 N명)", 날짜 = 확정일, 태그 = 정기모임
 */
function addToNotion_(dateText, loc, voters) {
  const schema = getNotionSchema_();
  const iso = parseNotionDate_(dateText);
  const title = '⚔️ 정기모임' + (loc ? ' @' + loc : '') +
    (voters && voters.length ? ' (참여 ' + voters.length + '명)' : '');

  const props = {};
  if (schema.titleProp) props[schema.titleProp] = { title: [{ text: { content: title } }] };
  if (schema.dateProp && iso) props[schema.dateProp] = { date: { start: iso } };
  if (schema.tagProp) props[schema.tagProp] = { multi_select: [{ name: '정기모임' }] };

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + CONFIG.NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify({
      parent: { database_id: CONFIG.NOTION_DB_ID },
      properties: props
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
}

// DB 속성 스키마를 읽어 title / date / multi_select 속성명을 자동으로 찾음
function getNotionSchema_() {
  const res = UrlFetchApp.fetch(
    'https://api.notion.com/v1/databases/' + CONFIG.NOTION_DB_ID, {
      headers: {
        Authorization: 'Bearer ' + CONFIG.NOTION_TOKEN,
        'Notion-Version': '2022-06-28'
      },
      muteHttpExceptions: true
    });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
  const props = JSON.parse(res.getContentText()).properties || {};
  const out = { titleProp: null, dateProp: null, tagProp: null };
  Object.keys(props).forEach(function(name) {
    const type = props[name].type;
    if (type === 'title' && !out.titleProp) out.titleProp = name;
    if (type === 'date' && !out.dateProp) out.dateProp = name;
    if (type === 'multi_select' && !out.tagProp) out.tagProp = name;
  });
  return out;
}

/* 노션 연결 테스트: 에디터에서 실행해 스키마 확인 */
function testNotion() {
  Logger.log(JSON.stringify(getNotionSchema_()));
  addToNotion_('7/16(수) 20:00', '테스트 암장', ['김광훈', '이희주']);
  Logger.log('테스트 기록 완료 — 노션 캘린더 7/16 확인');
}

// "7/16(수) 20:00" / "2026-07-16" 등 → ISO(YYYY-MM-DD 또는 +시간)
function parseNotionDate_(label) {
  const tz = Session.getScriptTimeZone();
  let y = new Date().getFullYear();
  const ym = String(label).match(/(\d{4})/);
  if (ym) y = +ym[1];
  const md = String(label).match(/(\d{1,2})\s*[\/월.\-]\s*(\d{1,2})/);
  if (!md) return null;
  const mo = ('0' + md[1]).slice(-2), da = ('0' + md[2]).slice(-2);
  const tm = String(label).match(/(\d{1,2}):(\d{2})/);
  if (tm) {
    // 시간 포함 → 로컬 타임존 오프셋까지 붙여 ISO 생성
    const d = new Date(y, +md[1] - 1, +md[2], +tm[1], +tm[2]);
    return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return y + '-' + mo + '-' + da; // 종일
}
