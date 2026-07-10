# 석기시대 클럽 앱

동아리(석기시대) 운영용 웹앱 — 투표 · 사진 인증 · 벽화 갤러리 · 명예의전당 · 정산 · PIN 신원확인.

기존 Google Apps Script 단일 웹앱을 **3-tier 구조**로 이전하는 중:

```
Front (Netlify)  ──JSON──▶  Back (Apps Script)  ──▶  DB (Google Sheet / Drive / Photos)
```

## 폴더 구조

| 경로 | 내용 |
|---|---|
| `apps-script/` | 백엔드 — JSON API (doGet/doPost 라우팅). [README](apps-script/README.md) |
| `frontend/` | 프론트 — 정적 사이트 + PWA (Phase 5에서 구축) |
| `docs/` | 인계 문서 |
| `v3.0.2/` | AS-IS 원본 웹앱 (참고/아카이브) |

## 문서

- [architecture.md](docs/architecture.md) — 구조 · 데이터 흐름 · **API 명세**
- [deploy.md](docs/deploy.md) — 프론트/백엔드 배포 순서 · exec URL 유지
- [env.md](docs/env.md) — 어떤 값이 어디에 필요한지
- [handover.md](docs/handover.md) — 계정/자산 인계 · 장애 시 확인 순서

## 진행 계획

전체 실행 계획과 함정 모음은 [CLAUDE.md](CLAUDE.md), Phase별 할 일은
[GitHub Issues](https://github.com/stoneage-webapp/webapp/issues) #1~#9 참고.
