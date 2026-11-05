# 사번·비밀번호 작업일보 — 배포 안내

2026-11-03 운영 배포와 실제 로그인·등록·조회 검증을 완료했습니다.
현재 적용 상태, 데이터 수량, 남은 보안 항목은 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.

이 패키지는 2026-09-07 작업본을 바탕으로 변경한 버전입니다.
작업자·금형·작업코드 실데이터, 공개 Supabase 키, 브라우저용 Excel/JSON을 public 폴더에 넣지 않습니다.
로그인 화면은 정적 HTML이며 데이터 권한은 서버와 DB에서 검사합니다.
인증 후 화면에 표시하는 본인 정보와 조회한 금형 1건은 브라우저 메모리에 존재합니다.
브라우저로 화면을 제공하면서 이 표시 데이터까지 숨기는 것은 불가능합니다.

## 구조와 운영 방식

- public/: 로그인, PIN 변경, 작업일보 화면만 배포
- netlify/functions/api.mjs: 인증·세션·조회·저장 서버
- database/001_secure_auth.sql: DB 마이그레이션
- admin/manage.mjs: 관리자 로컬 계정/데이터 도구
- tests/: 실제 PostgreSQL 엔진을 이용한 로컬 검증. 인명/금형은 모두 테스트 값
- qa/: 화면 테스트 산출물, 운영 데이터 없음

사번은 기존 자료와 동일한 숫자 9자리입니다. 새 비밀번호는 숫자만 또는 영문+숫자 8~32자리이며, 사번 및 현재 비밀번호와 달라야 합니다.
운영자 요청으로 초기 비밀번호는 사번과 같습니다. 첫 로그인 때 변경 안내가 표시됩니다. “다음에 변경”은 현재 로그인 세션에서 안내를 미루고, “30일간 묻지 않기”는 해당 계정의 안내를 30일간 미룹니다. 유예 중에도 기존 비밀번호로 작업할 수 있습니다.
로그인 입력은 영문/숫자만 허용하고 공백·한글·특수문자는 제외합니다. 사번 자체는 9자리 숫자로 검증합니다.
사번을 아는 사람이 초기 계정을 먼저 사용할 위험이 있으므로 관리자부터 즉시 개인 비밀번호를 설정하세요.
관리자 화면과 다른 작업자 대신 입력하는 방법은 [ADMIN.md](ADMIN.md)를 참고하세요.
사번과 이름만 입력해 타인의 계정을 선점하는 가입 기능은 제공하지 않습니다.
개인 PIN은 Supabase Auth에서 해시로 보관하며 직원 테이블에 저장하지 않습니다.

세션은 8시간이며 개인 정보/초안/토큰을 localStorage 또는 sessionStorage에 저장하지 않습니다.
새로고침 시 미제출 입력은 사라집니다. 로그인 세션은 HttpOnly/Secure 쿠키로 유지됩니다.
등록 후 누락되지 않도록 성공 안내까지 기다려 주세요.
작업 1건당 10~5,000분, 1회 최대 10개, 10분 단위를 서버에서도 검사합니다. 이번 등록 합계가 540분을 넘으면 예/아니오 확인창이 표시됩니다. 예를 선택한 경우에만 저장하며 서버도 확인값을 검사합니다. 하루 1,440분 제한은 제거했습니다.

## 1. Supabase 준비

1. 기존 DB를 백업하고 기존 익명 웹 사용을 잠시 중지합니다.
2. SQL Editor에서 database/001_secure_auth.sql 전체를 실행합니다.
   기존 worklog 행은 보존하고 새 user_id 등만 추가합니다.
   기존 submit_worklog_batch/get_worklog_summary는 제거하므로 이전 HTML은 즉시 동작하지 않습니다.
   기존 public.swmno 테이블이 있다면 database/002_legacy_mold_access.sql도 실행합니다.
   이 파일은 기존 금형 행을 보존하며 직접 API 접근 권한과 정책을 제거합니다.
   이어서 database/003_admin.sql을 실행해 관리자 권한과 대신 입력 기능을 추가합니다.
   마지막으로 database/004_workflow_update.sql을 실행합니다. 이미 운영 중인 DB에는 004만 적용하고 웹과 서버 함수를 함께 배포하세요.
3. Authentication에서 Email 비밀번호 로그인을 활성화하고 공개 회원가입과 익명 로그인을 비활성화합니다.
4. Auth의 최소 길이는 8자리로 유지하고 문자 종류 필수 정책은 설정하지 않습니다.
   사번으로 된 초기 비밀번호를 허용하기 위해서이며, 앱 서버는 새 비밀번호에 숫자를 포함하도록 검사하며 숫자만 사용해도 됩니다.
5. Require current password when updating을 켭니다. Secure password change도 사용할 수 있습니다.
   앱이 PIN 변경 직전에 현재 PIN으로 다시 로그인하므로 새 인증 세션에서 변경됩니다.
   이메일 OTP를 직접 요구하는 별도 흐름은 사용하지 않습니다.
6. 계정 생성은 초대 메일이 아닌 관리자 API의 email_confirm:true 방식입니다. SMTP는 사용하지 않습니다.
7. Authentication의 API 속도 제한을 점검합니다. 70명이 공유 IP로 로그인하거나 최초 PIN 변경을 동시에
   진행하면 Supabase 자체 한도에 걸릴 수 있으므로 최초 등록은 나누어 진행하고 실제 교대시간에 부하 검증합니다.
   앱 자체 제한은 사번별 15분 10회, IP별 15분 300회이며 Supabase 제한은 별개입니다.

새 기준정보 테이블은 Table Editor에서 wl_private 스키마를 선택하면 확인할 수 있습니다.
wl_private를 Data API의 Exposed schemas 목록에 추가하지 마세요.
employees의 user_id/active/must_change_pin은 인증 상태이므로 임의로 수정하지 마세요.
금형은 molds, 직원 이름·소속·조는 employees, 선택 항목은 catalog에서 관리합니다.
SQL은 최초 생성 때만 catalog를 채우므로 재실행해도 관리자가 수정한 목록을 덮어쓰지 않습니다.
계정 비활성화는 employees.active=false로 설정하면 즉시 서버 접근이 차단됩니다.

## 2. 서버 환경변수

Netlify 사이트 → Environment variables에서 아래 값을 Functions 범위에 설정합니다.
요금제에서 범위를 개별 선택할 수 없다면 Contains secret values를 켜고
Production 컨텍스트만 선택합니다. 이 경우 Builds/Functions/Runtime 범위를 사용하게 됩니다.
운영 APP_ORIGIN과 배포 URL이 정확히 일치해야 합니다(끝에 / 없음).
프로덕션 이외 preview에 운영 비밀키를 주입하지 마세요. 개발은 별도 DB로 분리하세요.

| 이름 | 값 |
|---|---|
| SUPABASE_URL | 현재 Supabase 프로젝트 URL |
| SUPABASE_PUBLISHABLE_KEY | Publishable key |
| SUPABASE_SECRET_KEY | 서버 전용 Secret key (기존 service_role JWT도 지원) |
| APP_ORIGIN | 예: https://내사이트.netlify.app |
| AUTH_ID_DOMAIN | 관리하는 도메인의 내부 로그인용 하위 도메인 |
| SESSION_KEY | 무작위 32바이트를 hex 64글자로 표현한 값 |

SESSION_KEY 생성 (Node.js 22 이상):
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

AUTH_ID_DOMAIN은 사번을 Supabase 내부 계정 ID로 바꾸기 위한 값입니다.
사용자 메일함을 만들거나 메일을 수신할 필요는 없습니다.
다른 사람이 소유한 도메인은 쓰지 말고 최초 계정 생성 후에는 값을 바꾸지 마세요.
내부 로그인 ID가 이메일 형식이라는 이유만으로 SMTP를 연결할 필요는 없습니다.
SESSION_KEY를 변경하면 기존 쿠키는 무효가 됩니다.

비밀키는 public/, HTML, config.js, Git 저장소 또는 채팅에 넣지 않습니다.
관리자 도구는 로컬 .env 파일에서만 읽도록 .env.example을 복사한 후 값을 채웁니다.
.env 파일은 배포/공유 ZIP에 포함하지 않습니다.

## 3. 기존 데이터 이전

이 패키지에는 직원/금형 원본을 넣지 않았습니다.
원본 자료의 최신 버전을 확인한 다음 비공개 경로에서 가져오세요.

기존 JSON이 최신 데이터와 같을 때:
node --env-file=.env admin/manage.mjs import-json "C:/비공개/employee-master.json" "C:/비공개/mold-master.json"

현재 작업 폴더에 있는 이전 JSON 경로:
C:/Users/geonhoshin/Documents/Codex/2026-08-20/g/work/worklog-site/data/employee-master.json
C:/Users/geonhoshin/Documents/Codex/2026-08-20/g/work/worklog-site/data/mold-master.json

이전 웹의 master-data.xlsx를 JSON 생성 이후에 수정했다면 먼저 그 수정 내용을 DB에 반영해야 합니다.
오래된 JSON으로 최신 Excel을 덮어쓰지 마세요.
최초 이전 이후 기준정보는 Supabase에서 관리하며 배포파일을 수정할 필요가 없습니다.
추가 JSON 가져오기는 아래 형식(실제 파일은 비공개 위치)에 맞춰 실행합니다.

node --env-file=.env admin/manage.mjs import employees "C:/비공개/employees.json"
형식: [{"employee_no":"사번9자리","name":"이름","department":"소속","team":"조"}]

node --env-file=.env admin/manage.mjs import molds "C:/비공개/molds.json"
형식: [{"number":"금형5자리","car":"차종","part":"품명"}]

## 4. 작업자 계정 생성 / PIN 재설정

node --env-file=.env admin/manage.mjs create 사번9자리
node --env-file=.env admin/manage.mjs reset 사번9자리

초기 비밀번호는 해당 사번으로 설정하며 비밀번호를 터미널에 출력하지 않습니다.
관리자 웹 화면에서도 직원 계정 추가와 초기화를 할 수 있습니다.
사용자가 새 비밀번호를 설정하면 초기 비밀번호는 무효가 됩니다.
PIN 변경/관리자 초기화 시 기존 앱 세션은 전부 종료됩니다.

관리자 초기화는 먼저 계정을 비활성화하고 세션을 폐기합니다.
Auth 변경 중 실패하면 비활성 상태를 유지하여 안전하게 중단합니다.
복구 시 같은 reset을 다시 실행하세요.
create가 Auth 생성 직후 실패했다면 Auth Users에서 해당 사번 계정 UUID를 확인하고,
SQL Editor에서 wl_admin_bind('사번', 'UUID')로 재연결한 후 reset을 실행하세요.
새 계정을 만들려고 사번을 바꾸거나 기존 Auth 사용자를 무작정 삭제하지 마세요.

이전 익명 작업일보의 user_id는 자동 연결하지 않았습니다.
과거에는 이름/사번을 위조할 수 있었으므로 관리자가 확인한 데이터만 아래 조건으로 연결하세요.
이 SQL은 예시이며 해당 작업자의 실제 UUID와 사번/이름으로 바꿔 실행합니다.
update public.worklog set user_id = '확인한 UUID'
where user_id is null and "Id" = 확인한사번 and name = '확인한이름';
연결 전 과거 행은 직원 조회에 나타나지 않으며 데이터 자체는 그대로 보존됩니다.

## 5. Netlify 배포

이번 버전은 서버 함수가 필요하므로 public 폴더만 Netlify Drop에 끌어 놓아서는 로그인할 수 없습니다.
Git 연결 배포 또는 Netlify CLI로 정적 파일과 함수를 함께 배포하세요.

Git 저장소에는 이 프로젝트의 소스만 추가하고 Netlify에서 연결합니다.
현재 저장소는 운영자의 요청에 따라 공개 상태를 유지합니다. 직원·금형 원본과 비밀키를 커밋하지 마세요.
- Base directory: 이 프로젝트
- Build command: 비워 둠
- Publish directory: public
- Functions directory: netlify/functions
- Node runtime: 22 이상 (현재 서비스에서 지원하는 버전 확인)

CLI를 사용한다면 프로젝트 루트에서:
npx netlify-cli login
npx netlify-cli link
npx netlify-cli deploy --prod --dir=public --functions=netlify/functions

배포 시 환경변수 설정과 SQL/기준정보/계정 준비가 선행되어야 합니다.
public만 수동 업로드하거나 기존 공개 data 폴더와 합쳐 배포하지 마세요.

이전 배포 이력에 직원 Excel/JSON이 들어 있습니다.
신규 배포는 /data/*를 410으로 막지만 과거 Netlify 배포 고유 URL까지 삭제하지는 못합니다.
운영 전 Netlify에서 해당 과거 배포/미리보기 접근을 차단하거나 삭제하세요.
이미 다운로드된 파일, 온라인 업데이트를 받지 않은 기기의 캐시는 서버에서 회수할 수 없습니다.
새 sw.js는 새 버전을 방문한 기기에서 기존 field-worklog 캐시를 제거하고 스스로 해제합니다.

## 6. 실제 운영 확인

로컬 테스트는 운영 데이터에 접근하지 않았습니다. 다음은 실제 배포 후 확인해야 합니다.
- 미로그인 /api/me, /api/mold, /api/options, /api/submit → 401
- 직원 A와 B를 각각 만들고 서로의 이력 접근이 불가능한지 확인
- 초기 비밀번호 → 개인 비밀번호 변경 또는 변경 안내 유예 → 작업 화면
- 로그인 후 이름/사번/소속/조 자동 표시, 수정 불가
- 금형번호 실제 1건 조회와 미등록 번호/빈 금형 구분
- 2건 등록, 응답 유실 재시도, 월별 합계, 로그아웃 후 재접근
- 퇴사자 비활성/관리자 PIN 초기화 후 기존 기기 세션 차단
- /data/*, /config.js, /database/*, /.env, /admin/*, 옛 배포 URL의 비공개 여부
- Supabase Security Advisor 및 database/audit.sql로 기존 별도 테이블/뷰/함수의 공개 권한 확인

## 검증 실행
pnpm install --frozen-lockfile
node --test tests/api.test.mjs tests/workflow.test.mjs
node tests/ui.mjs

UI 테스트는 Playwright와 Edge가 필요합니다. PLAYWRIGHT_MODULE 환경변수로
설치된 playwright 모듈 경로를 지정할 수 있습니다.
PGlite/Playwright는 로컬 검증용이며 운영 API는 외부 npm 의존성이 없습니다.

모든 취약점이 없다는 보장은 할 수 없습니다. 확인 범위와 남은 항목은 SECURITY.md에 기록했습니다.

