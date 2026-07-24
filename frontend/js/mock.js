/**
 * mock.js — 개발/미리보기용 목데이터 (?mock=1 로 열었을 때만 활성화)
 * 운영에서는 아무 것도 하지 않는다. 백엔드 응답 형태는 docs/architecture.md 와 동일.
 */
(function () {
  if (new URLSearchParams(location.search).get('mock') !== '1') return;

  // 백엔드는 항상 오름차순으로 정렬해 내려준다 — 미리보기도 그 결과를 흉내낸다.
  const MEMBERS = ['김광훈', '박도윤', '이희주', '정민재', '최서연'];
  const DI = function (iso, time) {
    const d = new Date(iso);
    const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return { iso: iso, ym: iso.slice(0, 7), weekday: w, time: time || null,
      display: iso + ' (' + w + ')' + (time ? ' ' + time : '') };
  };
  const now = new Date();
  const ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  const d1 = ym + '-16', d2 = ym + '-23';

  const DATA = {
    members: MEMBERS,
    months: ['2026-06', ym],
    raidMonths: [
      { month: '2026-06', deadline: '2026-06-05', closed: true, confirmed: { date: '2026-06-18', loc: '클라이밍파크', note: '' },
        options: [{ date: '2026-06-18', loc: '클라이밍파크', dateInfo: DI('2026-06-18', ''), voters: ['김광훈'] }] },
      { month: ym, deadline: ym + '-10', closed: false, confirmed: null,
        options: [
          { date: '7/16(수) 20:00', loc: '더클라임 강남', dateInfo: DI(d1, '20:00'), voters: ['김광훈', '이희주'] },
          { date: '7/23(수) 20:00', loc: '클라이밍파크 사당', dateInfo: DI(d2, '20:00'), voters: ['박도윤'] }
        ] }
    ],
    disaster: [
      { date: '7/19 14:00 @ 클라이밍파크', loc: '클라이밍파크', dateInfo: DI(ym + '-19', '14:00'), voters: ['최서연'] }
    ],
    certified: { '김광훈': true, '이희주': true },
    month: ym,
    shareUrl: '', notionUrl: '', openchatUrl: 'https://open.kakao.com/o/g5IQRRBi',
    confirmed: { disaster: null },
    admins: ['김광훈'],
    settlers: ['이희주'],
    support: { '김광훈': true, '박도윤': true, '이희주': true, '정민재': false, '최서연': true },
    notices: [
      { when: '2026-07-10', by: '김광훈', text: '7월 회비는 15일까지 계좌로 부탁드려요!', row: 3 },
      { when: '2026-07-02', by: '김광훈', text: '이번 달 정기공격 장소 투표 열렸습니다 — 참여 부탁!', row: 2 }
    ],
    flashOwners: { '7/19 14:00 @ 클라이밍파크': '최서연' }
  };

  const HALL = {
    ym: ym, winnerMonth: '2026-06',
    winner: { title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], fileId: 'x', link: '#', ym: '2026-06' },
    entries: [{ title: '오버행 돌파', by: '김광훈', voters: ['이희주'], fileId: 'y', link: '#', ym: ym, when: '' }]
  };

  // 완료기록 목데이터 — 이번 달 번개 완료 건에 '박도윤'을 넣어 인증 리마인드(certNudge) 시나리오를 흉내낸다.
  const COMPLETION_LOG = [
    { when: '2026-06-20 22:10', kind: '정기공격', month: '2026-06', date: '2026-06-18', loc: '클라이밍파크', people: '김광훈', by: '김광훈' },
    { when: ym + '-19 22:30', kind: '자연재해', month: ym, date: ym + '-19 14:00', loc: '클라이밍파크', people: '최서연, 박도윤', by: '최서연' }
  ];
  function certNudgeFor(name) {
    if (!name || DATA.certified[name]) return false;
    return COMPLETION_LOG.some(function (it) {
      return it.month === ym && it.people.split(',').map(function (s) { return s.trim(); }).indexOf(name) > -1;
    });
  }

  // 부족원 추가/수정/삭제 후 백엔드가 돌려주는 스냅샷 형식 흉내 (members·support·settlers)
  function memberSnap() {
    return { members: MEMBERS.slice().sort(), support: DATA.support, settlers: DATA.settlers };
  }

  // ── 레벨(난이도)별 완등 순위 목데이터 ──
  let LEVELS = ['흰', '노', '주', '초', '파', '빨'];       // 낮은→높은 순
  const LEVEL_COUNTS = {                                   // { 이름: { 레벨: 완등수 } }
    '김광훈': { '흰': 15, '노': 10, '주': 6, '초': 3, '파': 1 },
    '이희주': { '흰': 12, '노': 9, '주': 6, '초': 3, '파': 1 },
    '박도윤': { '흰': 8, '노': 4, '주': 1 },
    '최서연': { '흰': 5, '노': 2 }
    // 정민재: 기록 없음 (rank=null 시나리오)
  };
  function levelBoard() {
    const roster = MEMBERS.slice().sort();
    const rows = roster.map(function (name) {
      const raw = LEVEL_COUNTS[name] || {};
      const c = {};
      let topIdx = -1, total = 0;
      LEVELS.forEach(function (lv, i) {
        const n = raw[lv] || 0;
        if (n > 0) { c[lv] = n; total += n; if (i > topIdx) topIdx = i; }
      });
      const topLevel = topIdx >= 0 ? LEVELS[topIdx] : '';
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
    return { levels: LEVELS.slice(), rows: rows };
  }

  window.API_MOCK = {
    handle: function (fn, args) {
      const T = {
        getInitData: DATA,
        getHallData: HALL,
        getHallArchive: { winners: [{ ym: '2026-06', title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], link: '#', fileId: 'x', when: '' }] },
        getGallery: { items: [
          { when: ym + '-05', actDate: ym + '-05', loc: '더클라임 강남', people: '김광훈, 이희주', by: '김광훈', fileId: 'mk1', link: '#' },
          { when: ym + '-02', actDate: ym + '-02', loc: '클라이밍파크', people: '김광훈', by: '김광훈', fileId: 'mk2', link: '#' }
        ], hasMore: false },
        getNotices: { items: DATA.notices },
        getStats: (function () {
          const requester = args[0];
          const names = requester === '김광훈'
            ? MEMBERS
            : MEMBERS.filter(function (m) { return m === requester; });
          const cert = {}, votes = {};
          cert['2026-06'] = requester === '김광훈' ? { '김광훈': true } : {};
          cert[ym] = requester === '김광훈'
            ? { '김광훈': true, '이희주': true }
            : (requester === '이희주' ? { '이희주': true } : {});
          votes[ym] = requester === '김광훈'
            ? { '김광훈': true, '이희주': true, '박도윤': true }
            : (['이희주', '박도윤'].indexOf(requester) > -1
              ? (function () { const o = {}; o[requester] = true; return o; })()
              : {});
          return {
            months: ['2026-06', ym],
            members: names.map(function (m) { return { name: m, supported: DATA.support[m] !== false }; }),
            cert: cert,
            votes: votes
          };
        })(),
        // getSettleStatus(ym): 열=월 누적 스키마 — 상태만(장소/링크 없음)
        getSettleStatus: { ym: ym, months: ['2026-06', ym], rows: [
          { name: '김광훈', status: 'O' },
          { name: '박도윤', status: '정산 취소' },
          { name: '이희주', status: 'X' },
          { name: '정민재', status: '지원 제외' },
          { name: '최서연', status: 'X' }
        ] },
        cancelSettle: { ym: ym, months: ['2026-06', ym], rows: [
          { name: '김광훈', status: 'O' },
          { name: '박도윤', status: '취소 해제' },
          { name: '이희주', status: 'X' }
        ] },
        resetSettle: { reset: true, ym: ym },
        getVenueStats: { month: ym, total: [{loc:'더클라임 강남',count:8},{loc:'클라이밍파크',count:5},{loc:'볼더링존',count:2}], thisMonth: [{loc:'더클라임 강남',count:3}] },
        getCompletionLog: { items: COMPLETION_LOG.slice().reverse() },
        loginWithPin: { name: args[0], token: 'mock-token', isAdmin: args[0] === '김광훈', driveApiKey: '', certNudge: certNudgeFor(args[0]) },
        changePin: { name: args[0], token: 'mock-token', isAdmin: args[0] === '김광훈', driveApiKey: '', certNudge: certNudgeFor(args[0]) },
        toggleVote: { date: args[1], voters: [args[2]] },
        addFlash: DATA.disaster, deleteFlash: DATA.disaster,
        // T의 모든 필드는 fn 과 무관하게 매 호출마다 즉시 평가되므로(아래 목데이터 조회용 IIFE들과 동일 구조),
        // DATA를 실제로 변형하는 아래 세 액션은 반드시 fn 가드로 감싸 다른 액션 호출 시 오작동을 막는다.
        editFlash: (function () {
          if (fn !== 'editFlash') return DATA.disaster;
          const row = DATA.disaster.find(function (x) { return x.date === args[0]; });
          if (row) {
            const newDate = args[1], loc = args[2];
            row.date = newDate + ' @ ' + loc;
            row.loc = loc;
            const iso = newDate.split(' ')[0], time = newDate.split(' ')[1] || null;
            row.dateInfo = DI(iso, time);
          }
          return DATA.disaster;
        })(),
        completeFlash: (function () {
          if (fn !== 'completeFlash') return DATA.disaster;
          const idx = DATA.disaster.findIndex(function (x) { return x.date === args[0]; });
          if (idx > -1) DATA.disaster.splice(idx, 1);
          return DATA.disaster;
        })(),
        completeRaid: (function () {
          if (fn !== 'completeRaid') return DATA.raidMonths;
          const idx = DATA.raidMonths.findIndex(function (x) { return x.month === args[0]; });
          if (idx > -1) DATA.raidMonths.splice(idx, 1);
          return DATA.raidMonths;
        })(),
        editRaidOption: (function () {
          if (fn !== 'editRaidOption') return DATA.raidMonths;
          const g = DATA.raidMonths.find(function (x) { return x.month === args[0]; });
          if (g) {
            const o = g.options.find(function (x) { return x.date === args[1]; });
            if (o) { o.date = args[2]; o.loc = args[3]; o.dateInfo = null; } // 실제 백엔드는 새 날짜를 dateInfo_로 재파싱
          }
          return DATA.raidMonths;
        })(),
        deleteRaidOption: (function () {
          if (fn !== 'deleteRaidOption') return DATA.raidMonths;
          const g = DATA.raidMonths.find(function (x) { return x.month === args[0]; });
          if (g) { const i = g.options.findIndex(function (x) { return x.date === args[1]; }); if (i > -1) g.options.splice(i, 1); }
          return DATA.raidMonths;
        })(),
        confirmDate: DATA.raidMonths,
        // note 반영은 서버가 하므로 mock은 기존 데이터 반환
        postNotice: { items: [{ when: 'now', by: args[1], text: args[0], row: 4 }].concat(DATA.notices) },
        deleteNotice: { items: DATA.notices.slice(1) },
        resetPin: { name: args[0], reset: true },
        // 부족원 CRUD — DATA/MEMBERS 를 실제로 변형하므로 fn 가드 필수 (flash 계열과 동일 패턴)
        addMember: (function () {
          if (fn !== 'addMember') return memberSnap();
          const n = String(args[0] || '').trim();
          if (n && MEMBERS.indexOf(n) < 0) { MEMBERS.push(n); DATA.support[n] = true; }
          return memberSnap();
        })(),
        renameMember: (function () {
          if (fn !== 'renameMember') return memberSnap();
          const oldN = String(args[0] || '').trim(), newN = String(args[1] || '').trim();
          const i = MEMBERS.indexOf(oldN);
          if (i > -1 && newN && MEMBERS.indexOf(newN) < 0) {
            MEMBERS[i] = newN;
            DATA.support[newN] = DATA.support[oldN]; delete DATA.support[oldN];
            const si = DATA.settlers.indexOf(oldN); if (si > -1) DATA.settlers[si] = newN;
          }
          return memberSnap();
        })(),
        deleteMember: (function () {
          if (fn !== 'deleteMember') return memberSnap();
          const n = String(args[0] || '').trim();
          const i = MEMBERS.indexOf(n);
          if (i > -1) {
            MEMBERS.splice(i, 1); delete DATA.support[n]; delete LEVEL_COUNTS[n];
            DATA.settlers = DATA.settlers.filter(function (x) { return x !== n; });
          }
          return memberSnap();
        })(),
        // 레벨 순위/기록
        getLevelBoard: levelBoard(),
        setLevels: (function () {
          if (fn !== 'setLevels') return levelBoard();
          if (Array.isArray(args[0])) {
            LEVELS = args[0].map(function (s) { return String(s).trim(); }).filter(Boolean);
          }
          return levelBoard();
        })(),
        setLevelRecord: (function () {
          if (fn !== 'setLevelRecord') return levelBoard();
          const nm = String(args[0] || '').trim();
          const counts = (args[1] && typeof args[1] === 'object') ? args[1] : {};
          if (MEMBERS.indexOf(nm) > -1) {
            const c = {};
            LEVELS.forEach(function (lv) {
              const v = parseInt(counts[lv], 10);
              if (!isNaN(v) && v > 0) c[lv] = v;
            });
            LEVEL_COUNTS[nm] = c;
          }
          return levelBoard();
        })(),
        runSettle: { ym: args[0], done: 2, total: 4, independent: 1, canceled: 1, copied: 1, uncovered: ['박도윤'] },
        setSettlers: { settlers: args[0] },
        setSupports: (function () { const on = Array.isArray(args[0]) ? args[0] : []; const s = {}; MEMBERS.forEach(function (m) { s[m] = on.indexOf(m) > -1; }); return { support: s }; })(),
        voteHall: HALL, deleteHallEntry: HALL, finalizeHallEntry: HALL,
        deleteProof: { ok: true },
        startUpload: 'mock://upload', startHallUpload: 'mock://upload',
        uploadChunk: { done: true, fileId: 'mock' }, checkUploadStatus: { done: false },
        finalizeProof: { link: '#', photos: '완료' }
      };
      if (fn in T) return Promise.resolve(T[fn]);
      return Promise.reject(new Error('mock 미구현: ' + fn));
    }
  };
  console.log('[mock] API_MOCK 활성화됨');
})();
