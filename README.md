# my-first-hy

**울산대 SW 공고 모아보기** — 울산대학교 SW 서포터즈 활동용 사이트입니다. SW 관련 **대외활동·공모전**, **인턴** 공고와 **'울산대 SW' 소식**을 1시간마다 모아 보여줍니다.

```
GitHub Actions (매시 17분)          Supabase                     Vercel
collector/index.mjs  ──upsert──▶  postings 표  ◀──읽기(공개 키)──  public/ (정적 사이트)
  네이버 뉴스 / 고용24 / 사람인 API   collector_runs 표
  위비티 / 콘테스트코리아 / SW중심대학사업단 공지
```

| 폴더 | 내용 |
| --- | --- |
| `public/` | 웹사이트 (빌드 없는 HTML/CSS/JS). 카테고리 필터, 마감일 정렬, 검색 |
| `collector/` | 수집기 (Node 20+, 외부 패키지 없음) |
| `supabase/schema.sql` | 표 생성 SQL |
| `.github/workflows/collect.yml` | 1시간마다 수집기 실행 |

## 설정 순서

### 1. Supabase 표 만들기
Supabase 대시보드 → **SQL Editor** → `supabase/schema.sql` 내용을 붙여넣고 실행합니다.
공개 키로는 읽기만, Secret 키로만 쓰기가 되도록 RLS가 설정됩니다.

### 2. API 키 발급
| 키 | 발급처 |
| --- | --- |
| 네이버 Client ID / Secret | [네이버 개발자센터](https://developers.naver.com/apps/#/register) → 애플리케이션 등록 → 사용 API: **검색** |
| 고용24 인증키 | [고용24](https://www.work24.go.kr) → 고객지원 → 오픈API → **채용정보** API 신청 |
| 사람인 access-key | [사람인 Open API](https://oapi.saramin.co.kr) → 로그인 → **access-key 발급받기** (승인까지 시간이 걸릴 수 있음) |
| Supabase Secret 키 | Supabase → Project Settings → **API Keys** → Secret keys (`sb_secret_...`) |

### 3. GitHub Secrets 등록
저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
| --- | --- |
| `SUPABASE_SECRET_KEY` | Supabase Secret 키 |
| `NAVER_CLIENT_ID` | 네이버 Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 Client Secret |
| `WORK24_AUTH_KEY` | 고용24 인증키 |
| `SARAMIN_ACCESS_KEY` | 사람인 access-key |

키가 없는 출처는 건너뛰고 나머지만 수집합니다. 등록 후 **Actions → 공고 수집 → Run workflow**로 바로 한 번 실행해 보세요.

### 4. Vercel 배포
Vercel → **Add New → Project** → 이 저장소 Import → 설정은 그대로 두고 Deploy.
(`vercel.json`이 `public/` 폴더를 정적 사이트로 배포하도록 지정합니다. 환경 변수는 필요 없습니다.)

## 수집 출처와 이용 정책 확인 (2026-10-05 기준)

| 출처 | 방식 | 카테고리 | 확인 내용 |
| --- | --- | --- | --- |
| 네이버 검색 API (뉴스) | 공식 API | 울산대 소식 | '울산대'와 SW 관련 단어가 모두 들어간 기사만 저장, 원문 링크 제공 |
| 고용24 채용정보 Open API | 공식 API | 인턴 | '인턴' 검색 결과 중 SW 직무만 저장 |
| 사람인 채용공고 Open API | 공식 API | 인턴 | IT개발·데이터 직무 + 인턴직만 요청. 이용 조건에 따라 사이트 하단에 "채용정보 제공: 사람인" 표시 |
| 위비티 (wevity.com) | 목록 페이지 크롤링 | 대외활동 | robots.txt `Allow: /`. 이용약관에 크롤링 금지 조항은 없고 저작권 침해 금지 조항이 있음 → **제목·주최·마감일·링크만** 저장, 본문·포스터는 저장 안 함. 요청 간격 2초 |
| 울산대 SW중심대학사업단 (sw.ulsan.ac.kr) | 공지 상세 페이지 | 울산대 소식 / 인턴 | robots.txt `Allow: /`. 새 글만 따라가며 읽음, 요청 간격 1.5초 |
| ~~울산대 본 사이트 (www.ulsan.ac.kr)~~ | 수집 안 함 | — | robots.txt가 `Disallow: /` |
| 콘테스트코리아 (contestkorea.com) | 목록 페이지 크롤링 | 대외활동 | robots.txt `Allow: /`. 이용약관에 크롤링 금지 조항 없음. 콘텐츠 저작권 안내가 있어 **제목·주최·마감일·링크만** 저장. 요청 간격 2초 |
| ~~링커리어~~ | 수집 안 함 | — | 이용약관에서 자동화 프로그램으로 서비스에 접근하는 행위와 크롤링·스크래핑을 금지 |
| ~~캠퍼스픽~~ | 수집 안 함 | — | 이용약관(커뮤니티 이용규칙)에서 "게시물 크롤링"을 금지 |
| ~~요즘것들 (allforyoung)~~ | 수집 안 함 | — | 이용약관에서 데이터베이스 제작자 권리를 주장하며 복제를 금지 |

링커리어 등 금지된 곳의 공고를 넣고 싶다면 운영사에 제휴나 사용 허락을 먼저 받으세요. 허락을 받으면 그 조건에 맞춰 수집기를 추가할 수 있습니다.

크롤링 출처는 정책이 바뀔 수 있으니 학기마다 robots.txt와 약관을 다시 확인하세요.
수집기는 `UOU-SW-Supporters-Bot/1.0` User-Agent로 요청합니다.

## 로컬에서 테스트

```bash
cd collector
node index.mjs --dry-run   # 저장 없이 수집 결과만 출력 (키 없으면 위비티·콘테스트코리아·사업단만)
```

웹사이트는 `public/index.html`을 아무 정적 서버로 열면 됩니다. (예: `npx serve public`)

## 참고
- 공개 저장소는 60일 동안 커밋이 없으면 GitHub가 예약 실행을 자동으로 멈춥니다. 멈췄다면 Actions 탭에서 다시 켜 주세요.
- SW사업단 공지의 마감일은 본문에서 추정한 값이라 사이트에 "(추정)"으로 표시됩니다.
- 수집 키워드는 `collector/lib.mjs`의 `SW_KEYWORDS`, 출처별 검색어는 `collector/sources/*.mjs` 상단에서 바꿀 수 있습니다.
