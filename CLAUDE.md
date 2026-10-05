# 울산대 SW 공고 모아보기: Claude 작업 안내

정적 사이트(`public/`) + 수집기(`collector/`, GitHub Actions 매시 17분) + Supabase(`postings` 표).
배포: `main`에 푸시하면 Vercel이 사이트를 다시 배포합니다. 원격: `uouclaudecode-cpu/my-first-hy`.

## 사용자가 공고를 붙여넣으면 → `data/manual-postings.json`에 추가

사용자가 링커리어 등에서 직접 보고 복사한 공고 텍스트(또는 링크와 설명)를 주면:

1. 아래 양식으로 정리해 **배열 맨 앞에** 추가합니다.
2. 커밋 전에 `node -e "JSON.parse(require('fs').readFileSync('data/manual-postings.json','utf8'))"`로 JSON이 올바른지 확인하고, `main`에 커밋·푸시합니다. 이 파일이 바뀌면 워크플로가 `--only=manual`로 바로 실행돼 1~2분 안에 사이트에 반영됩니다.
3. 정리한 결과(제목·분류·마감일)를 사용자에게 짧게 보여주고, 추정한 값이 있으면 알려줍니다.

```json
{
  "id": "2026-10-05-kakao-tech-campus",
  "category": "activity",
  "title": "카카오테크 캠퍼스 4기 모집",
  "organization": "카카오",
  "url": "https://원문-링크",
  "deadline": "2026-10-20",
  "summary": "대학생 대상 6개월 개발 교육 과정. 백엔드·프론트엔드·AI 트랙.",
  "via": "링커리어",
  "tags": ["교육", "백엔드"],
  "added_at": "2026-10-05"
}
```

| 필드 | 규칙 |
| --- | --- |
| `id` | `추가일-영문-요약` 형식, 파일 안에서 중복 금지. 수정할 때는 id를 바꾸지 않습니다 |
| `category` | `activity`(대외활동·공모전·교육), `intern`(인턴·채용형 인턴), `uou_news`(울산대 소식) 중 하나 |
| `title` | 원문 제목을 그대로, 앞뒤 광고 문구(【급구】 등)만 정리 |
| `organization` | 주최·주관·회사명 |
| `url` | 원문 공고 주소 (http/https). 없으면 사용자에게 물어봅니다 |
| `deadline` | `YYYY-MM-DD`. 연도가 없으면 오늘 기준 가까운 미래로. 상시 모집이면 생략 |
| `summary` | **Claude가 직접 쓴 1~2문장 요약** (대상·혜택·분야). 원문 문단을 복사하지 않습니다 |
| `via` | 어디서 가져왔는지 (링커리어, 학과 공지, 지인 공유 등). 선택 |
| `tags` | 2~3개, 선택 |
| `added_at` | 추가한 날 (KST) |

- 저작권: 본문·포스터·이미지는 넣지 않습니다. 제목·주최·마감일·링크 같은 사실 정보와 직접 쓴 요약만 넣습니다.
- 삭제: 사용자가 지워 달라고 하면 배열에서 빼고 푸시합니다. 다음 실행 때 DB에서도 지워집니다.
- 마감이 지난 항목은 사이트에서 자동으로 숨겨지므로 굳이 지우지 않아도 됩니다.

## 글쓰기 프롬프트 (네이버 블로그 · 인스타 · 에브리타임)

- 사이트의 "🟢 네이버 블로그" / "📸 인스타 게시글" / "💬 에브리타임" 버튼은 `public/app.js`의 `blogPrompt` / `instaPrompt` / `everytimePrompt`(`PROMPTS`에 등록)가 만든 프롬프트를 복사합니다.
  어떤 AI(ChatGPT·Claude·Gemini)에 붙여넣어도 동작하도록 특정 서비스 이름이나 기능에 기대지 않는 일반 지시문으로 유지합니다.
- 사이트에는 로그인·AI API 호출이 없습니다(비용 없음). 다시 추가하지 않습니다.
- 사용자가 이 채팅에 그 프롬프트를 붙여넣거나 직접 글을 부탁하면, 프롬프트의 규칙(공고 정보의 사실만, 해요체, 이모지, 형식)대로 써 줍니다.
- 스팸 방문자 글 삭제는 Supabase Table Editor에서 합니다(관리자 페이지 없음).

## 수집 출처 추가 시

`collector/sources/`에 모듈을 추가하고 `collector/index.mjs`의 `sources`에 등록합니다.
크롤링 출처는 robots.txt와 이용약관을 먼저 확인하고 README의 출처 표에 기록합니다.
링커리어·캠퍼스픽·요즘것들은 약관상 금지라 자동 수집하지 않습니다(직접 추가는 가능).

## 배포 시

`public/index.html`의 `style.css?v=…`, `app.js?v=…` 버전 값을 바꿔서 브라우저가 예전 파일을 쓰지 않게 합니다.

## 테스트

```bash
cd collector && node index.mjs --dry-run          # 전체 출처, 저장 안 함
cd collector && node index.mjs --dry-run --only=manual
```
