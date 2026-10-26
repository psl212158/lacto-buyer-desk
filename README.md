# 락토코리아 바이어 데스크

해외 전시회(SIAL Paris 2026 등)에서 만난 바이어의 상담 기록, 주소록, 팔로우업을 팀이 함께 관리하는 사이트입니다.

- 사이트: https://psl212158.github.io/lacto-buyer-desk/
- 화면: GitHub Pages (`index.html`)
- 데이터: 구글 시트 + Apps Script (`apps-script/Code.gs`)
- 명함 자동 인식: Claude API (Apps Script 서버에서 호출, 키는 서버에만 보관)
- 상담 사진(명함, 바이어와 함께 찍은 사진 등): 구글 드라이브 폴더

이 저장소에는 바이어 데이터가 들어 있지 않습니다. 데이터는 구글 시트와 드라이브에만 저장되고, 사이트는 팀 접속 코드를 아는 사람만 열 수 있습니다.

## 처음 설정 (한 번만)

### 1. 구글 시트와 Apps Script

1. 구글 드라이브에서 새 스프레드시트를 만들고 이름을 `락토코리아 바이어 데스크`로 정합니다.
2. 메뉴 **확장 프로그램 → Apps Script**를 엽니다.
3. 기본 `Code.gs` 내용을 지우고 이 저장소의 [`apps-script/Code.gs`](apps-script/Code.gs) 전체를 붙여 넣은 뒤 저장합니다.
4. 왼쪽 **프로젝트 설정(톱니바퀴) → 스크립트 속성 → 스크립트 속성 추가**에서 두 값을 넣습니다.

   | 속성 | 값 |
   |---|---|
   | `ACCESS_CODE` | 팀이 사이트에 입력할 접속 코드 (추측하기 어려운 값으로) |
   | `ANTHROPIC_API_KEY` | Claude API 키 (`sk-ant-…`). 없으면 명함 자동 인식만 꺼집니다 |

5. 편집기 위쪽 함수 목록에서 `setup`을 고르고 **실행**을 누릅니다. 권한 요청이 나오면 본인 계정으로 허용합니다.
   - 시트 탭(shows, buyers, meetings, followups, 바이어 리스트)이 생기고, SIAL Paris 2026이 등록되고, 드라이브에 `락토코리아 바이어 데스크 사진` 폴더가 생깁니다.
6. **배포 → 새 배포 → 유형 선택(톱니바퀴) → 웹 앱**
   - 다음 사용자 인증 정보로 실행: **나**
   - 액세스 권한이 있는 사용자: **모든 사용자**
   - **배포**를 누르고 나오는 웹 앱 URL(`https://script.google.com/macros/s/…/exec`)을 복사합니다.

### 2. 사이트 주소 연결

`config.js`의 `apiUrl`에 위 웹 앱 URL을 넣고 커밋하면, 팀원은 접속 코드와 이름만 입력하면 됩니다.
비워 두면 로그인 화면에서 서버 주소를 직접 입력합니다.

### 3. GitHub Pages 켜기

이미 켜져 있습니다. 사이트는 `gh-pages` 브랜치에서 배포되며 https://psl212158.github.io/lacto-buyer-desk/ 에서 열립니다.
`main` 하나로만 관리하고 싶다면 **Settings → Pages → Build and deployment**에서 Branch를 **main / (root)**로 바꾸면 됩니다.

## Claude API 키 발급

1. https://console.anthropic.com 에 가입하고 결제 수단(크레딧)을 등록합니다.
2. **API Keys → Create Key**로 키를 만들어 위 `ANTHROPIC_API_KEY`에 넣습니다.
3. 모델은 `Code.gs` 위쪽 `MODEL` 상수(`claude-opus-5-5`)에서 바꿀 수 있습니다.

## 코드를 고친 뒤

- `index.html`, `config.js`를 고치면 `main`에 커밋한 뒤 같은 내용을 `gh-pages`에도 푸시해야 사이트에 반영됩니다 (`git push origin main main:gh-pages`). 1~2분 뒤 바뀝니다.
- `Code.gs`를 고치면 Apps Script에 다시 붙여 넣고 **배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포**를 누릅니다. 웹 앱 URL은 그대로 유지됩니다.

## 데이터 구조

| 시트 탭 | 내용 |
|---|---|
| shows | 참가 전시회 (이름, 장소, 기간, 부스) |
| buyers | 바이어 회사·담당자, 등급, 진행 단계, 다음 액션 |
| meetings | 상담 기록 (일자, 관심 제품, 요청사항, 메모, 사진 목록) |
| followups | 팔로우업 기록 (연락 방식, 내용, 바이어 반응, 다음 액션) |
| 바이어 리스트 | 사람이 보는 표. 10분마다, 또는 시트 메뉴 **바이어 데스크 → 바이어 리스트 새로고침**으로 갱신 |

shows / buyers / meetings / followups 탭은 사이트가 읽고 쓰는 원본이라 직접 고치지 마세요.
