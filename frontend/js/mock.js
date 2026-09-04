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

  // 공지: 최신순. pinned=고정. 홈은 "고정 전부 + 최신 1건"만 노출. ts=등록시각(ms, 새공지 뱃지용)
  const NOTICES = [
    { when: ym + '-12', by: '김광훈', text: '이번 주 정모 사진 인증 잊지 마세요!', row: 4, pinned: false, ts: now.getTime() - 2 * 3600e3 },
    { when: '2026-07-10', by: '김광훈', text: '회비 계좌: OO은행 000-0000 (매월 15일)', row: 3, pinned: true, ts: now.getTime() - 5 * 86400e3 },
    { when: '2026-07-02', by: '김광훈', text: '이번 달 정기공격 장소 투표 열렸습니다 — 참여 부탁!', row: 2, pinned: false, ts: now.getTime() - 12 * 86400e3 }
  ];
  function homeNotices() {
    const pinned = NOTICES.filter(function (n) { return n.pinned; });
    const latest = NOTICES.filter(function (n) { return !n.pinned; })[0];
    const home = pinned.slice();
    if (latest) home.push(latest);
    return home;
  }

  const DATA = {
    members: MEMBERS,
    months: ['2026-06', ym],
    // 정기공격은 더 이상 투표하지 않음 — 월마다 고정 일정 하나(기본값: 둘째 주 금요일 + 위치 로테이션, isOverride=관리자 지정 여부)
    raidSchedule: [
      { month: ym, date: ym.slice(5, 7) + '/17 20:00', loc: '사당', note: '', isOverride: false, dateInfo: DI(ym + '-17', '20:00') }
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
    notices: homeNotices(),
    recent: { // 최근 24h 벽화/전당 (홈 "새 소식")
      murals: [{ kind: '사진', loc: '더클라임 강남', by: '이희주', when: '오늘 09:12' }],
      hall: [{ by: '박도윤', title: '오버행 돌파', when: '오늘 08:40' }]
    },
    dormant: { '박도윤': '2026-11-30' }, // { 이름: 'yyyy-MM-dd' } — 휴면 중 (K열). 갤러리 투명도 미리보기용
    roles: { '김광훈': '고인돌', '박도윤': '조약돌', '이희주': '팀장', '정민재': '부족심사중', '최서연': '조약돌' },
    roleList: ['부족심사중', '조약돌', '간석기', '고인돌', '팀장'],
    rsvp: { '2026-06': { '김광훈': 'yes', '이희주': 'no' }, [ym]: { '이희주': 'yes', '박도윤': 'no', '최서연': 'no' } },
    flashOwners: { '7/19 14:00 @ 클라이밍파크': '최서연' },
    // 정기 오픈 세션 (특정 날짜+장소, 캘린더에서 여러 날짜 선택해 등록)
    openSessions: [
      { id: 'os1', date: ym + '-09', loc: '더클라임 강남', note: '초보 환영', createdBy: '이희주',
        createdAt: '2026-07-01T00:00:00.000Z', voters: ['이희주'], dateInfo: DI(ym + '-09', '') }
    ],
    openSessionRoles: ['팀장'],
    flashRoles: ['부족심사중', '조약돌', '간석기', '고인돌', '팀장'], // 기본값: 전체 허용
    raidLocations: ['신림', '사당', '이수', '논현', '양재']
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

  // 부족원 추가/수정/삭제 후 백엔드가 돌려주는 스냅샷 형식 흉내 (members·support·dormant·settlers)
  function memberSnap() {
    return { members: MEMBERS.slice().sort(), support: DATA.support,
             dormant: DATA.dormant, roles: DATA.roles, roleList: DATA.roleList,
             settlers: DATA.settlers };
  }

  // ── 부족 예산 목데이터 (정산 적립 / 사용 이력) ──
  const BUDGET = [
    { when: ym + '-01 10:00', kind: '적립', amount: 15000, note: '2026-07 정산 적립 (3명 × 5,000원)', by: '김광훈', month: '2026-07', row: 2 },
    { when: ym + '-05 19:20', kind: '사용', amount: 42000, note: '뒤풀이 치킨', by: '이희주', month: '', row: 3 }
  ];
  function budgetSnap() {
    let credit = 0, spent = 0;
    BUDGET.forEach(function (b) { if (b.kind === '적립') credit += b.amount; else spent += b.amount; });
    return { balance: credit - spent, credit: credit, spent: spent, perPerson: 5000,
             items: BUDGET.slice().reverse() };
  }

  window.API_MOCK = {
    handle: function (fn, args) {
      const T = {
        getInitData: (function () { DATA.notices = homeNotices(); return DATA; })(),
        getHallData: HALL,
        getHallArchive: { winners: [{ ym: '2026-06', title: '보라 완등', by: '이희주', voters: ['김광훈', '박도윤'], link: '#', fileId: 'x', when: '' }] },
        getGallery: { items: [
          { when: ym + '-05', actDate: ym + '-05', loc: '더클라임 강남', people: '김광훈, 이희주', by: '김광훈', fileId: 'mk1', link: '#' },
          { when: ym + '-02', actDate: ym + '-02', loc: '클라이밍파크', people: '김광훈', by: '김광훈', fileId: 'mk2', link: '#' },
          { when: ym + '-01', actDate: ym + '-01', loc: '더클라임 강남', people: '박도윤', by: '박도윤', fileId: 'mk3', link: '#' } // 휴면 회원 — 투명도 미리보기
        ], hasMore: false },
        getNotices: { items: NOTICES.slice() },
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
          const opensessions = {};
          opensessions[ym] = requester === '김광훈'
            ? { '이희주': true }
            : (requester === '이희주' ? { '이희주': true } : {});
          return {
            months: ['2026-06', ym],
            members: names.map(function (m) { return { name: m, supported: DATA.support[m] !== false }; }),
            cert: cert,
            votes: votes,
            opensessions: opensessions
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
        toggleVote: { date: args[0], voters: [args[1]] }, // 자연재해 전용 — (dateText, voter, token)
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
          if (fn !== 'completeRaid') return DATA.raidSchedule;
          const idx = DATA.raidSchedule.findIndex(function (x) { return x.month === args[0]; });
          if (idx > -1) DATA.raidSchedule.splice(idx, 1);
          return DATA.raidSchedule;
        })(),
        // 관리자: 그 달 정기공격 날짜/장소/설명 지정 — (month, date, loc, note, requester, token)
        setRaidDate: (function () {
          if (fn !== 'setRaidDate') return DATA.raidSchedule;
          const month = args[0], date = String(args[1] || '').trim(),
            loc = String(args[2] || '').trim(), note = String(args[3] || '').trim();
          let g = DATA.raidSchedule.find(function (x) { return x.month === month; });
          if (!g) { g = { month: month, date: '', loc: '', note: '', isOverride: false, dateInfo: null }; DATA.raidSchedule.push(g); }
          if (date) {
            g.date = date; g.loc = loc; g.note = note; g.isOverride = true;
            // 날짜는 'M/d HH:mm' 같은 자유 서식 — 실제 백엔드(dateInfo_)처럼 월 힌트로 연도 보정해 파싱
            const d = (typeof parseDateClient === 'function') ? parseDateClient(date, month) : null;
            const tm = date.match(/(\d{1,2}):(\d{2})/);
            g.dateInfo = d ? DI(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2),
              tm ? tm[0] : null) : null;
          } else {
            g.isOverride = false; // 실제 백엔드는 기본값(둘째 주 금요일+로테이션)으로 재계산하지만 mock은 마지막 값 유지
          }
          return DATA.raidSchedule;
        })(),
        // 공지: 등록/삭제/고정 모두 { items(전체), home(고정+최신1) } 반환
        postNotice: (function () {
          if (fn !== 'postNotice') return { items: NOTICES.slice(), home: homeNotices() };
          const maxRow = NOTICES.reduce(function (m, n) { return Math.max(m, n.row); }, 1);
          NOTICES.unshift({ when: 'now', by: args[1], text: args[0], row: maxRow + 1, pinned: false, ts: Date.now() });
          return { items: NOTICES.slice(), home: homeNotices() };
        })(),
        editNotice: (function () {
          if (fn !== 'editNotice') return { items: NOTICES.slice(), home: homeNotices() };
          const n = NOTICES.find(function (x) { return x.row === Number(args[0]); });
          if (n) n.text = String(args[2] || '').trim() || n.text;
          return { items: NOTICES.slice(), home: homeNotices() };
        })(),
        deleteNotice: (function () {
          if (fn !== 'deleteNotice') return { items: NOTICES.slice(), home: homeNotices() };
          const i = NOTICES.findIndex(function (n) { return n.row === Number(args[0]); });
          if (i > -1) NOTICES.splice(i, 1);
          return { items: NOTICES.slice(), home: homeNotices() };
        })(),
        pinNotice: (function () {
          if (fn !== 'pinNotice') return { items: NOTICES.slice(), home: homeNotices() };
          const n = NOTICES.find(function (x) { return x.row === Number(args[0]); });
          if (n) n.pinned = !!args[2];
          return { items: NOTICES.slice(), home: homeNotices() };
        })(),
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
            MEMBERS.splice(i, 1); delete DATA.support[n];
            DATA.settlers = DATA.settlers.filter(function (x) { return x !== n; });
          }
          return memberSnap();
        })(),
        runSettle: { ym: args[0], done: 2, total: 4, independent: 1, dormant: 0, canceled: 1, copied: 1, uncovered: ['박도윤'], credited: 10000 },
        getBudget: budgetSnap(),
        addExpense: (function () {
          if (fn !== 'addExpense') return budgetSnap();
          const amt = parseInt(String(args[0]).replace(/[^\d]/g, ''), 10) || 0;
          const maxRow = BUDGET.reduce(function (m, b) { return Math.max(m, b.row); }, 1);
          if (amt > 0) BUDGET.push({ when: 'now', kind: '사용', amount: amt, note: String(args[1] || ''), by: args[2], month: '', row: maxRow + 1 });
          return budgetSnap();
        })(),
        deleteBudgetItem: (function () {
          if (fn !== 'deleteBudgetItem') return budgetSnap();
          const i = BUDGET.findIndex(function (b) { return b.row === Number(args[0]); });
          if (i > -1) BUDGET.splice(i, 1);
          return budgetSnap();
        })(),
        setSettlers: { settlers: args[0] },
        setRsvp: (function () {
          if (fn !== 'setRsvp') return { rsvp: DATA.rsvp };
          const month = args[0], status = args[1], name = args[2];
          DATA.rsvp = DATA.rsvp || {};
          const m = DATA.rsvp[month] || (DATA.rsvp[month] = {});
          if (status === 'yes' || status === 'no') m[name] = status; else delete m[name];
          return { rsvp: DATA.rsvp };
        })(),
        setAdmins: (function () {
          if (fn !== 'setAdmins') return { admins: DATA.admins };
          DATA.admins = Array.isArray(args[0]) ? args[0].slice() : DATA.admins;
          return { admins: DATA.admins };
        })(),
        setDormant: (function () {
          if (fn !== 'setDormant') return memberSnap();
          const nm = String(args[0] || '').trim(), until = String(args[1] || '').trim();
          DATA.dormant = DATA.dormant || {};
          if (until) DATA.dormant[nm] = until; else delete DATA.dormant[nm];
          return memberSnap();
        })(),
        setRole: (function () {
          if (fn !== 'setRole') return memberSnap();
          const nm = String(args[0] || '').trim(), role = String(args[1] || '').trim();
          DATA.roles = DATA.roles || {};
          if (DATA.roleList.indexOf(role) > -1) DATA.roles[nm] = role;
          return memberSnap();
        })(),
        setSupports: (function () { const on = Array.isArray(args[0]) ? args[0] : []; const s = {}; MEMBERS.forEach(function (m) { s[m] = on.indexOf(m) > -1; }); return { support: s }; })(),
        // 정기 오픈 세션 — DATA를 실제로 변형하므로 fn 가드 필수 (flash 계열과 동일 패턴)
        getOpenSessions: { items: DATA.openSessions, roles: DATA.openSessionRoles },
        addOpenSession: (function () {
          if (fn !== 'addOpenSession') return { items: DATA.openSessions, roles: DATA.openSessionRoles };
          const dates = Array.isArray(args[0]) ? args[0] : [];
          const loc = String(args[1] || '').trim(), note = String(args[2] || '').trim();
          const now = new Date().toISOString();
          dates.forEach(function (date, i) {
            DATA.openSessions.push({
              id: 'os' + (DATA.openSessions.length + 1 + i), date: date, loc: loc, note: note,
              createdBy: args[3], createdAt: now, voters: [args[3]], dateInfo: DI(date, '')
            });
          });
          return { items: DATA.openSessions, roles: DATA.openSessionRoles };
        })(),
        toggleOpenSessionVote: (function () {
          if (fn !== 'toggleOpenSessionVote') return { id: args[0], voters: [] };
          const row = DATA.openSessions.find(function (x) { return x.id === args[0]; });
          if (!row) return { id: args[0], voters: [] };
          if (!row.voters) row.voters = [];
          const i = row.voters.indexOf(args[1]);
          if (i > -1) row.voters.splice(i, 1); else row.voters.push(args[1]);
          return { id: args[0], voters: row.voters };
        })(),
        editOpenSession: (function () {
          if (fn !== 'editOpenSession') return { items: DATA.openSessions, roles: DATA.openSessionRoles };
          const it = DATA.openSessions.find(function (x) { return x.id === args[0]; });
          if (it) {
            it.date = String(args[1] || '').trim(); it.loc = String(args[2] || '').trim(); it.note = String(args[3] || '').trim();
            it.dateInfo = DI(it.date, '');
          }
          return { items: DATA.openSessions, roles: DATA.openSessionRoles };
        })(),
        deleteOpenSession: (function () {
          if (fn !== 'deleteOpenSession') return { items: DATA.openSessions, roles: DATA.openSessionRoles };
          DATA.openSessions = DATA.openSessions.filter(function (x) { return x.id !== args[0]; });
          return { items: DATA.openSessions, roles: DATA.openSessionRoles };
        })(),
        completeOpenSession: (function () {
          if (fn !== 'completeOpenSession') return { items: DATA.openSessions, roles: DATA.openSessionRoles };
          DATA.openSessions = DATA.openSessions.filter(function (x) { return x.id !== args[0]; });
          return { items: DATA.openSessions, roles: DATA.openSessionRoles };
        })(),
        setOpenSessionRoles: (function () {
          if (fn !== 'setOpenSessionRoles') return { items: DATA.openSessions, roles: DATA.openSessionRoles };
          if (Array.isArray(args[0]) && args[0].length) DATA.openSessionRoles = args[0].slice();
          return { items: DATA.openSessions, roles: DATA.openSessionRoles };
        })(),
        setFlashRoles: (function () {
          if (fn !== 'setFlashRoles') return { roles: DATA.flashRoles };
          if (Array.isArray(args[0]) && args[0].length) DATA.flashRoles = args[0].slice();
          return { roles: DATA.flashRoles };
        })(),
        setRaidLocations: (function () {
          if (fn !== 'setRaidLocations') return { locations: DATA.raidLocations };
          if (Array.isArray(args[0]) && args[0].length) DATA.raidLocations = args[0].slice();
          return { locations: DATA.raidLocations };
        })(),
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
