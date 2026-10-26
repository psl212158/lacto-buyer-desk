# 인수인계: 락토코리아 바이어 데스크

새 Claude Code 세션이 이 프로젝트를 이어받을 때 읽는 문서입니다. 마지막 정리: 2026-10-26 (서버 배포 후).

## 1. 한 줄 요약

락토코리아(주)의 해외 전시회(SIAL Paris 2026 등) 바이어 상담·주소록·팔로우업 관리 사이트.
**화면은 GitHub Pages, 데이터는 구글 시트 + Apps Script, 사진은 구글 드라이브, 명함 인식은 구글 드라이브 OCR.**
팀원은 Claude를 쓰지 않으므로 **Claude·Anthropic 의존성은 넣지 않는다**(이미 전부 제거함).

- 사이트: https://psl212158.github.io/lacto-buyer-desk/ (배포됨, 로그인 화면까지 열리는 것 사용자 확인)
- 저장소: https://github.com/psl212158/lacto-buyer-desk (public)
- 사용자: 박태영 (psl212158@gmail.com). 한국어 반말 톤으로 대화.

## 2. 지금 상태

| 항목 | 상태 |
|---|---|
| 사이트 코드 (`index.html`) | 완료·배포됨 |
| 서버 (`apps-script/Code.gs`) | **배포됨 (2026-10-26, clasp).** 사용자 드라이브의 시트 "락토코리아 바이어 데스크" + 연결된 Apps Script. setup 완료, 접속 코드는 시트 '시작하기'!B4 |
| `config.js`의 `apiUrl` | 채움 (`…/macros/s/AKfycbwN47…/exec`) |
| 명함 인식 | 구글 드라이브 OCR. **실제 명함으로는 아직 확인 안 함** |
| 테스트 | `tests/` 통과 (`test-gas.js`에 doGet 자동 setup 케이스 추가) |
| Claude 아티팩트 버전 | 예전 프로토타입 https://claude.ai/artifact/7uAyE3yDxu6aGx211wtpVE. 팀이 못 쓰므로 **폐기 예정**. 사용자가 원하면 삭제 |

### 배포하면서 알게 된 것
- 사용자 PC에는 Node가 설치돼 있지 않았음. 포터블 Node 24를 `%LOCALAPPDATA%/Programs/node-v24.22.1-win-x64`에 풀고, 거기에 clasp 3.4.1을 전역 설치함(명령 실행 전에 PATH에 추가할 것).
- `clasp login` 동의 화면에서 체크박스를 안 누르면 이메일 권한만 넘어오고, `create`가 "insufficient authentication scopes"로 실패함. 이때는 **모두 선택**하고 다시 로그인.
- `clasp create`는 `apps-script/appsscript.json`을 기본값으로 덮어씀. 다시 복원한 뒤 `push --force`.
- 소유자가 권한을 허용한 뒤에도 익명 요청이 몇 분 동안 403("액세스 거부됨 · Drive 액세스 권한 필요")을 돌려줌. 기다리면 풀렸음.
- `.clasp.json`(scriptId)은 커밋하지 않음(.gitignore). 사용자 PC의 저장소 폴더에만 있음.

## 3. 바로 할 일 (우선순위 순)

1. 실제 명함 한 장으로 **드라이브 OCR이 실제로 동작하는지** 확인. 실패하면 응답 `error: 'ocr_failed'`의 HTTP 코드를 볼 것.
2. 사용자에게 팀원 안내 문구(사이트 주소 + 접속 코드 + 이름 입력)를 만들어 주기.
3. (선택) '시작하기' 탭의 '서버 주소' 칸이 안내 문구로 남아 있음. 편집기에서 setup을 돌렸을 때는 `ScriptApp.getService().getUrl()`이 /exec를 주지 않았음.
4. (선택) Claude 아티팩트 삭제 여부 확인.

## 4. 파일 구조

```
index.html            사이트 전체(HTML+CSS+JS 한 파일, 약 2,300줄)
config.js             window.LK_CONFIG = { apiUrl: '' }  ← /exec 주소
assets/logo.png       LACTO KOREA 로고 (투명 PNG, 207×89)
apps-script/Code.gs   Apps Script 서버 (약 570줄)
apps-script/appsscript.json  웹 앱 매니페스트 (실행: 나 / 액세스: 모든 사용자, Asia/Seoul)
README.md             사용자용 설정 안내 (한국어)
HANDOFF.md            이 문서
.nojekyll             GitHub Pages가 Jekyll 처리하지 않게
tests/
  gas-stub.js         Code.gs를 Node vm에서 돌리는 가짜 구글 서비스
                      (SpreadsheetApp, DriveApp, UrlFetchApp, ScriptApp 등)
  test-gas.js         서버 테스트: setup·접속 코드·CRUD·사진·바이어 리스트·단독 스크립트 모드
  test-ocr.js         명함 글자 파서 테스트 (FR/DE/AE/ES/NL 가상 명함) + 드라이브 OCR 요청 형식
  e2e.js              Playwright로 index.html을 스텁 서버에 붙여 전체 흐름 확인
  dev-server.js       localhost에서 사이트 + 스텁 서버(/api)를 띄움. 접속 코드 lacto-test로 자동 로그인, 예시 데이터 포함
  fixtures/card0.jpg, card1.jpg   테스트용 가짜 명함 이미지
```

실행:
```bash
node tests/test-gas.js
node tests/test-ocr.js
npm i -D playwright && npx playwright install chromium   # 로컬에서 처음 한 번
node tests/e2e.js    # 스크린샷은 tests/out/ (gitignore)
node tests/dev-server.js 8797   # 브라우저로 http://localhost:8797/ (구글 없이 화면 확인)
```

## 5. 아키텍처

```
[브라우저: GitHub Pages index.html]
   │  fetch POST (Content-Type: text/plain, body JSON {action, code, ...})
   ▼
[Apps Script 웹 앱 doPost]  ── 실행: 소유자 / 액세스: 모든 사용자 / 접속 코드로 보호
   ├─ 구글 시트 (탭 shows / buyers / meetings / followups / gallery: id | updatedAt | data JSON)
   ├─ '바이어 리스트' 탭 (사람용 표, 10분 트리거로 재생성)
   ├─ '시작하기' 탭 (사이트 주소·접속 코드·안내)
   └─ 드라이브 폴더 '락토코리아 바이어 데스크 사진' (상담 사진 + OCR 임시 문서)
```

- **인증:** 팀 공용 접속 코드(`ACCESS_CODE` 스크립트 속성). `setup()`이 없으면 `lacto-xxxxxxxx` 형태로 자동 생성. '시작하기'!B4를 고치고 setup 재실행 시 교체.
- **브라우저 저장(localStorage):** `lk-api`(서버 주소, config에 없을 때), `lk-code`, `lk-name`, `lk-staff`.
- **동기화:** 30초 폴링(`load`) + 화면 복귀 시 새로고침. 쓰기 중이면 폴링 결과를 버리고 다시 읽음.
- **동시성:** 서버 쓰기는 `LockService` 스크립트 락. `patch`는 상위 필드 단위 병합.
- **공개 범위:** 저장소·사이트 코드는 공개, 데이터 없음. `<meta name="robots" content="noindex">`.
- **GitHub Pages 소스는 `gh-pages` 브랜치.** 클라우드 세션에서 Pages API가 막혀서, gh-pages 브랜치 푸시로 자동 활성화했음. main과 gh-pages를 항상 같게 유지: `git push origin main main:gh-pages`.

### API (Code.gs `doPost`)
모든 요청: `{action, code, ...}`. 실패: `{ok:false, error, message}`.

| action | 입력 | 응답 |
|---|---|---|
| ping | – | `{ok, ocr:true, photos:true}` |
| load | – | `{ok, shows[], buyers[], meetings[], followups[], serverTime}` |
| save | `collection, id, doc` | `{ok, doc}` (전체 교체) |
| patch | `collection, id, fields` | `{ok, doc}` (상위 필드 병합, 없으면 not_found) |
| remove | `collection, id` | `{ok}` |
| ocr | `images:[{media_type, data(base64)}]` (1~2장, JPG/PNG/GIF) | `{ok, card, text}` |
| uploadPhoto | `media_type, data` | `{ok, id}` (드라이브 파일 id) |
| getPhoto | `id` | `{ok, media_type, data}` (사진 폴더 파일만) |
| deletePhoto | `id` | `{ok}` (휴지통) |

에러 코드: `unauthorized`, `setup_required`, `bad_request`, `not_found`, `busy`, `too_large`, `image_rejected`, `ocr_failed`, `server_error`.
`doGet`은 `{ok:true, service:'lacto-buyer-desk'}`. 배포 확인용.

### 데이터 모델 (시트 data 열의 JSON)
- **shows:** `name, venue, city, country, startDate, endDate (YYYY-MM-DD), booth, color(#hex), createdAt, updatedAt`. `setup()`이 `sial-paris-2026`(2026-10-17~21, Paris Nord Villepinte)을 시드.
- **buyers:** `company, country, city, bizType, website, grade('A'|'B'|'C'), companyInfo, contacts:[{name,title,email,phone,msg}], stage, nextAction, nextDate, showIds[], tags[], createdAt, updatedAt, by`
  - stage: `met`(상담완료) `info`(자료발송) `sample`(샘플발송) `quote`(견적·협상) `order`(오더 성사) `hold`(보류) `lost`(종료)
- **meetings:** `buyerId, showId, date, time, staff, interests[], requests[], notes, photos:[{id, thumb, kind('card'|'people'|'etc'), caption}], source('card'|'manual'), createdAt, updatedAt, by`
- **followups:** `buyerId, showId, date, type, staff, content, response, stageAfter, nextAction, nextDate, createdAt, updatedAt, by`
- **gallery (보류 갤러리):** `showId, date, photo:{id, thumb, kind, caption}, createdAt, updatedAt, by`. 바이어가 확실하지 않은 사진. 상담·통계에 안 들어감. "바이어에 연결" 시 그 바이어의 같은 날(없으면 최근) 상담 `photos`로 옮기고 문서 삭제

연동 규칙(요청 사항 2·3번의 핵심):
- 상담 저장 → 바이어 회사·담당자 정보를 폼 내용으로 갱신, `showIds`·`tags`는 그 바이어의 모든 상담에서 다시 계산, 다음 액션 반영.
- 팔로우업 저장 → 그 팔로우업이 날짜상 최신이면 바이어의 `stage / nextAction / nextDate`를 덮어씀.
- 사진은 상담 기록 단위로 저장(원본 1920px JPEG + 미리보기 480px 두 파일). 상담 삭제·바이어 삭제 시 드라이브 파일도 휴지통.

## 6. clasp로 서버 고치기 (사용자 PC)

```bash
export PATH="$LOCALAPPDATA/Programs/node-v24.22.1-win-x64:$PATH"   # Git Bash
clasp push --force                                   # apps-script/ 의 Code.gs + appsscript.json
clasp redeploy AKfycbwN47…(config.js 주소의 배포 id) --description "v3 …"   # 같은 URL에 새 버전
```

- 처음 배포 순서는 `clasp login` → `clasp create --type sheets --title "락토코리아 바이어 데스크" --rootDir apps-script` → manifest 복원 → `push` → `deploy`였음.
- 웹 앱 설정은 매니페스트(`appsscript.json`)에 있음: 실행 USER_DEPLOYING, 액세스 ANYONE_ANONYMOUS.
- **소유자가 스크립트 권한을 한 번 허용해야** 웹 앱이 동작함. 편집기에서 `setup`을 실행하거나 `/exec`를 브라우저로 열면 됨.
  - `doGet`은 `ACCESS_CODE`가 없으면 setup을 스크립트 락 안에서 실행함. 응답에 접속 코드는 넣지 않음.
- `clasp run`, `clasp logs`는 GCP 프로젝트 연결이 필요해 쓰지 않음. clasp 토큰은 Sheets API를 쓸 수 없지만, Drive export(`text/csv`)로 첫 탭은 읽을 수 있음.
- 구글 드라이브 MCP 커넥터로는 Apps Script 프로젝트를 만들 수 없음("first party item with content requires an external mime type").

## 7. index.html 구조 (찾아갈 때)

`<style>` 토큰(`:root` 밝은 테마, `prefers-color-scheme`/`[data-theme]` 어두운 테마) → 마크업(상단바 로고·버튼, `#main`, `#drawer`, `#modal`, `#toast`, `#lightbox`, `#foot`, `#login`) → `<script>` 하나(IIFE). 스크립트 주요 구역은 주석 `/* ---------- … ---------- */`로 구분:

- **constants:** STAGES, GRADES, FU_TYPES, REQUESTS, BIZ, COUNTRIES, SHOW_COLORS
- **state:** 객체 `S`
- **home:** `renderHome`, `badgeCard`(전시회 배지 카드)
- **show workspace:** `renderShow`(KPI 5개, 일자별 막대·진행 단계·국가 차트) + 탭 `renderDaily` / `renderBook`(전화번호부, 초성·알파벳 색인) / `renderFu`(지연·7일 이내·미착수·예정) / `renderGallery`(보류 갤러리; 폼 `openGalleryForm`·`openGalleryEdit`·`openGalleryLink`)
- **drawer:** `renderDrawer`(진행 단계 스테퍼, 담당자 복사·tel·mailto, `photoSection`, 타임라인 `tlMeet`/`tlFu`)
- **forms:**
  - `openMeetingForm`(명함 자동 입력 존 + 상담 사진 편집 + 기존 바이어 연결)
  - `openBuyerForm`, `openFuForm`(바이어 검색 선택, 연락 방식에 따라 단계 자동 추천)
  - `openShowForm`, `openCardBatch`(명함 일괄 등록, 동시 2장 인식, 중복 회사 연결)
- **business cards:** `prepImage`(캔버스 리사이즈), `parseCard`, `cardErr`, `findDup`, `mergeContacts`, `fillCard`, `ocrCard`
- **Photo 어댑터:** `Photo.upload/src/remove`(Apps Script 경유), `uploadPhotoItem`, `loadPhotos`, 라이트박스(`openLightbox`/`stepLb`, 키보드·스와이프)
- **server:** `API.call`, `makeDb()`(Firestore 비슷한 `collection().doc().set/update/delete` + `onSnapshot`을 Apps Script 위에 흉내), 폴링
- **login:** `showLogin`, `connect`, `logout`, `init`

CSV 내보내기는 Blob 다운로드(UTF-8 BOM, 수식 주입 방지 처리).

## 8. Code.gs 구조

`doPost` 라우팅 → 문서 CRUD(`ss_`, `sheet_`, `findRow_`, `load_`, `write_`, `save_`, `patch_`, `remove_`) → OCR(`ocr_`, `driveOcr_`, `parseCardText_`) → 사진(`photoFolder_`, `photoFile_`, `uploadPhoto_`, `getPhoto_`, `deletePhoto_`) → `rebuildBuyerSheet`(셀 값이 = + - @로 시작하면 `'` 붙임) → `onOpen` 메뉴, `setup`.

### 명함 OCR 방식
1. 이미지를 Drive v3 multipart 업로드로 `application/vnd.google-apps.document`로 변환. 이때 구글이 OCR을 함.
2. `files/{id}/export?mimeType=text/plain`으로 글자를 받고, 임시 문서는 휴지통으로 보냄.
3. `ScriptApp.getOAuthToken()` 사용. DriveApp을 쓰므로 drive 범위가 이미 있음.

`parseCardText_` 규칙 기반:
- **이메일·전화·웹사이트:** 정규식.
- **국가:** 국가명 단어 → 전화 국가번호 → 도메인 순.
- **도시:** 우편번호+도시 → 알려진 도시 목록.
- **직책:** 직책 단어. Manager/Director 같은 직급 단어가 있는 줄, 이름 옆 줄을 우선.
- **이름:** 대문자로 시작하는 2~4단어, 직책 바로 옆 줄을 우선.
- **회사:** 법인 형태(SARL·GmbH·LLC…) +3, 일반 단어(Foods·Trading…) +2, 도메인과 일치 +3.
- **나머지:** 주소 줄은 notes에, 업종은 단어로 추정.

정확도는 이메일·전화·웹 높음, 이름·회사·직책은 디자인에 따라 수정 필요. 사이트가 자동 입력 칸을 파란색으로 표시하므로 사용자 확인 전제.

## 9. 지금까지의 결정과 이유

| 결정 | 이유 |
|---|---|
| GitHub Pages + 구글 시트/Apps Script | 사용자가 GitHub 사용 결정. 기존 OYAMIL 프로젝트(`psl212158/oyamil-sial`)와 같은 구조 |
| 무료 github.io 주소 (www 도메인 없음) | 사용자 선택 |
| Claude API 제거 → 드라이브 OCR | 팀원이 Claude를 안 씀. 키·결제 불필요 |
| 접속 코드 1개 공유 | 단순성. 개인별 권한은 미구현 (아이디어: Apps Script에서 구글 로그인 기반으로 바꾸거나 사용자별 코드 테이블) |
| 사진을 상담 기록에 저장 | "상담 사진"으로 명함 + 바이어와 함께 찍은 사진 + 기타를 함께 관리 요청 |
| Pages 소스 gh-pages | 클라우드에서 Pages 설정 API가 막혀 우회 |

## 10. 원래 요청 사항 (사용자 표현 요약)

1. 날짜별 바이어 회사·담당자·회사 정보 기입. 날짜별 정리 페이지 1개 + 전화번호부 형식 1개
2. 바이어 정보와 상담 내용 작성 시 연동
3. 팔로우업 기입 후 저장하면 바이어 정보와 연동
4. 대시보드 형식, 전시회별로 가시적으로
5. 첫 화면에 기업 로고
6. 명함 사진 올리면 자동 추가
7. GitHub에 올려 웹 주소로 접속
8. 상담 사진: 명함 + 바이어와 함께 찍은 사진 업로드·저장·수정
9. 팀원은 Claude를 안 쓰므로 Claude 의존 제거

모두 구현됨. 남은 것은 3장의 배포·확인 작업.

## 11. 주의할 점

- 공개 저장소이므로 **접속 코드, API 키, 시트 id, `/exec` 외의 비밀을 커밋하지 말 것.** `/exec` 주소는 접속 코드 없이는 데이터를 못 읽으므로 `config.js`에 넣어도 됨.
- `Code.gs`를 고치면 사용자가 Apps Script에서 **배포 관리 → 수정 → 새 버전**으로 재배포해야 반영됨. URL은 유지.
- 사이트를 고치면 main과 gh-pages 둘 다 푸시.
- Apps Script V8에서 정규식 `\p{L}`(유니코드 속성)을 씀. 실제 환경에서 문제가 생기면 이 부분부터 확인.
- 소비자 구글 계정 한도: 트리거 총 실행 90분/일. 10분 트리거는 여유 있음. 폴링 30초는 웹 앱 실행이라 이 한도와 별개.
