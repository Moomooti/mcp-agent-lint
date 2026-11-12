# mcp-agent-lint

[![CI](https://github.com/Moomooti/mcp-agent-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/Moomooti/mcp-agent-lint/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-blue)

**MCP 서버를 AI 에이전트의 눈으로 검사하는 CLI.**
툴 설명은 충분한지, 파라미터에 설명이 있는지, 응답에 base64 이미지를 넣지 않았는지, 응답 속 링크가 살아 있는지 확인하고, 문제가 있으면 CI를 실패시켜요.

```text
$ mcp-agent-lint --probe examples/bad-fixture.probe.json --allow-destructive \
    --stdio -- node tests/fixtures/stdio-server.mjs bad

mcp-agent-lint · fixture-bad 1.0.0 · 2 tools · 2 probe calls

getStatus
  error  No description. The agent has only the name to guess from.  tool-description
  warn   annotations.destructiveHint  destructiveHint is not set, and per the MCP spec it then defaults to true (destructive).  annotations
  warn   probe[1]  Text response is 6,000 chars (max 4,000). Summarize, paginate, or return only what the agent needs.  response-size

throw poop!
  error  input.options  Parameter "options" has no description, so the agent has to guess its format and meaning.  param-description
  error  input.options.target  Parameter "options.target" has no description, so the agent has to guess its format and meaning.  param-description
  error  input.room  Parameter "room" has no description, so the agent has to guess its format and meaning.  param-description
  error  input.tags  Parameter "tags" has no description, so the agent has to guess its format and meaning.  param-description
  error  input.tags[].label  Parameter "tags[].label" has no description, so the agent has to guess its format and meaning.  param-description
  error  probe[0].content[1]  Returns an inline image block (2,160 base64 chars). Serve it by URL and put the URL in text.  response-inline-binary
  error  Description is 12 chars (min 40). Say what it does, when to use it, and what it returns.  tool-description
  error  Name "throw poop!" does not match ^[a-zA-Z0-9_-]{1,64}$. Many hosts reject or drop it.  tool-name
  warn   annotations.readOnlyHint  readOnlyHint is not set. Hosts must assume the tool changes state.  annotations

✖ 9 errors, 3 warnings
```

> 저장소에 들어 있는 "문제 있는 서버" 예제를 검사한 실제 출력이에요. 이 서버는 똥폭탄 MCP 서버가 처음에 겪었던 문제(base64 이미지 응답)를 그대로 재현해요.

<br/>

## 왜 만들었나요

카카오 PlayMCP 공모전에 [똥폭탄 MCP 서버](https://github.com/Moomooti/ddongpoktan-mcp)를 내면서 두 번 당했어요.

1. **base64 이미지 응답.** 툴 응답에 이미지를 base64로 넣었더니 PlayMCP의 답변 생성이 "일시적 오류"로 실패했어요. 이미지를 26MB에서 2.9MB로 줄여도 그대로였고, 이미지를 URL로 바꾸고서야 해결됐어요. 크기가 아니라 형식의 문제였어요.
2. **깨진 이미지 링크.** 이 도구를 처음 만들어 똥폭탄 서버에 돌렸더니, 서버가 `X-Forwarded-Proto` 헤더가 없으면 무조건 `https://`로 링크를 만들어서 로컬에서는 모든 이미지 링크가 깨진다는 걸 발견했어요.

둘 다 **사람이 화면으로 테스트하면 잘 보이지 않고, 에이전트가 실제로 호출해야 드러나는** 문제예요. 사람용 UI에는 린터가 많은데 "에이전트가 쓰는 인터페이스"를 검사하는 도구는 없어서, 한 번 겪은 문제를 다시 겪지 않도록 도구로 만들었어요.

<br/>

## 사용법

Node.js 20 이상이 필요해요.

```bash
# 설치 없이 바로 (GitHub에서 받아 빌드 후 실행)
npx github:Moomooti/mcp-agent-lint http://localhost:3000/mcp

# Streamable HTTP 서버
mcp-agent-lint http://localhost:3000/mcp
mcp-agent-lint https://example.com/mcp -H "Authorization: Bearer $TOKEN"

# stdio 서버: -- 뒤에 서버를 실행하는 명령
mcp-agent-lint --stdio -- node dist/server.js

# 실제 호출까지 해서 응답 검사 (+ 응답 속 링크 확인)
mcp-agent-lint http://localhost:3000/mcp --probe probe.json --check-links

# 규칙 조정, JSON 출력
mcp-agent-lint http://localhost:3000/mcp --rule tool-count=off --rule annotations=error --format json
```

| 옵션 | 설명 |
|---|---|
| `-H, --header "Name: value"` | HTTP 헤더 (여러 번 가능). 인증이나 프록시 헤더용 |
| `-p, --probe <file>` | 실제로 호출할 목록. 있으면 응답 규칙이 켜져요 |
| `--allow-destructive` | 읽기 전용이 아니거나 파괴적일 수 있는 툴의 호출을 허용 |
| `--check-links` | 응답 속 URL에 실제로 요청을 보내 확인 |
| `-r, --rule <id>=<level>` | 규칙 수준 변경: `off` · `warn` · `error` |
| `--min-description-length <n>` | 툴 설명 최소 길이 (기본 40) |
| `--max-tools <n>` | 툴 개수 상한 (기본 20) |
| `--max-response-chars <n>` | 응답 텍스트 상한 (기본 4,000) |
| `--max-warnings <n>` | 경고가 이보다 많으면 실패 |
| `-f, --format pretty\|json` | 출력 형식 |
| `--timeout <ms>` | 연결 제한 시간 (기본 30,000) |
| `--list-rules` | 규칙 목록 출력 |

**종료 코드**: `0` 오류 없음 · `1` 린트 오류(또는 경고 초과) · `2` 사용법·연결 문제

<br/>

## 규칙

| 규칙 | 기본 | 검사 대상 | 내용 |
|---|:-:|---|---|
| `tool-name` | error | tools/list | 이름이 `^[a-zA-Z0-9_-]{1,64}$`인지. 아니면 많은 호스트가 거부해요 |
| `tool-description` | error | tools/list | 설명이 있고 충분히 긴지 |
| `tool-description-length` | warn | tools/list | 설명이 1,024자를 넘지 않는지 |
| `param-description` | error | tools/list | 중첩된 것까지 모든 파라미터에 설명이 있는지 |
| `annotations` | warn | tools/list | `readOnlyHint` · `destructiveHint`를 선언했는지 |
| `tool-count` | warn | tools/list | 툴이 너무 많지 않은지 |
| `response-inline-binary` | error | probe | 이미지·오디오·base64를 응답에 직접 넣지 않았는지 |
| `response-size` | warn | probe | 응답이 너무 크지 않은지 |
| `response-empty` | warn | probe | 에이전트가 전할 텍스트가 있는지 |
| `response-unexpected-error` | error | probe | 성공·실패가 probe 파일의 기대와 같은지 |
| `response-broken-link` | error | probe | 응답 속 링크가 살아 있는지 (`--check-links`) |

규칙마다 왜 필요한지, 어떻게 고치는지는 [docs/rules.md](docs/rules.md)에 정리했어요.

<br/>

## probe 파일

응답 규칙은 실제 호출 결과가 있어야 검사할 수 있어서, 어떤 호출을 할지 파일로 적어요.

```json
{
  "calls": [
    { "tool": "check_status", "arguments": { "room_code": "lint", "nickname": "bot" } },
    { "tool": "throw_poop", "arguments": { "room_code": "lint", "nickname": "bot", "target_nickname": "friend" } },
    { "tool": "throw_poop", "arguments": { "room_code": "", "nickname": "bot" }, "expectError": true }
  ]
}
```

실제 예시는 [examples/ddongpoktan.probe.json](examples/ddongpoktan.probe.json)에 있어요.

**안전장치**: probe는 진짜 서버에 진짜 호출을 보내요. 그래서

- 서버에 없는 툴을 부르는 호출이 하나라도 있으면 **아무것도 호출하지 않고** 멈춰요 (오타 방지).
- 읽기 전용이 아니고 `destructiveHint: false`도 아닌 툴은 `--allow-destructive` 없이는 호출하지 않아요. MCP 명세상 이 값이 없으면 파괴적인 툴로 간주되기 때문이에요.
- 운영 서버가 아니라 테스트용 인스턴스에 돌리세요.

<br/>

## CI에서 쓰기

```yaml
- run: npm run build
- run: node dist/index.js &          # 내 MCP 서버 실행
- run: npx -y github:Moomooti/mcp-agent-lint http://localhost:3000/mcp --probe probe.json --check-links
```

오류가 있으면 종료 코드 `1`로 job이 실패해요. `--format json`으로 결과를 다른 도구에 넘길 수도 있어요.

<br/>

## 라이브러리로 쓰기

```ts
import { connect, lintServer, lintTools, formatPretty } from 'mcp-agent-lint';

// 서버에 붙어서 검사
const { client, close } = await connect({ kind: 'http', url: 'http://localhost:3000/mcp' });
const report = await lintServer(client, { severities: { 'tool-count': 'off' } });
console.log(formatPretty(report));
await close();

// 이미 가진 tools/list 결과만 검사 (네트워크 없음)
const findings = lintTools(tools);
```

<br/>

## 설계에서 신경 쓴 점

- **규칙은 순수 함수**: `tools/list` 결과나 호출 응답을 받아 결과 목록을 돌려줄 뿐이라, 서버 없이도 단위 테스트할 수 있어요. 네트워크가 필요한 링크 검사도 `fetch`를 주입받아서 테스트가 실제 네트워크를 쓰지 않아요.
- **실수는 크게 실패**: 없는 규칙 이름(`--rule tool-nmae=off`)이나 잘못된 probe 파일은 조용히 무시하지 않고 종료 코드 `2`와 함께 이유를 알려줘요.
- **서버가 죽으면 이유를 보여주기**: stdio 서버가 시작하다 죽으면 서버의 stderr 마지막 줄을 함께 보여줘요.
- **오류 형식 통일**: 서버가 `isError` 결과를 돌려주든 JSON-RPC 오류를 던지든 에이전트에게는 같은 "실패"라서 같은 것으로 다뤄요.
- **의존성 최소화**: 인자 파싱은 Node 내장 `util.parseArgs`, 색상은 ANSI 코드를 직접 써서 런타임 의존성은 MCP SDK와 zod뿐이에요. `NO_COLOR`와 파이프 출력도 지원해요.
- **엄격한 타입**: `strict`에 더해 `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 켜고, ESLint는 `strictTypeChecked`를 테스트 코드까지 적용해요.

<br/>

## 개발

```bash
npm ci
npm run check    # 타입 검사 → 린트 → 테스트 → 빌드
```

테스트 71개가 세 층으로 나뉘어 있어요.

| 층 | 무엇을 | 파일 |
|---|---|---|
| 규칙 단위 | 규칙마다 통과·실패 경계 (예: 설명 39자/40자, base64와 비슷하지만 아닌 문자열, 문장 끝 쉼표가 붙은 URL) | `tests/toolRules.test.ts`, `tests/responseRules.test.ts` |
| 서버 통합 | 메모리 안의 실제 MCP 서버(정상/문제 버전)에 붙어서 전체 결과, 페이지네이션, probe 안전장치 확인 | `tests/lintServer.test.ts` |
| CLI | stdio 서버를 실제 프로세스로 띄우고, HTTP 서버를 실제 포트로 띄워서 출력 · 종료 코드 · 사용법 오류 확인 | `tests/cli.test.ts` |

CI는 Node 20 · 22 · 24에서 위 과정을 돌리고, 마지막에 **패키지로 묶어 전역 설치한 CLI**가 실제로 동작하는지까지 확인해요.

```
src/
├── cli.ts              # 인자 파싱, 출력, 종료 코드
├── lint.ts             # lintServer · lintTools · lintResponses
├── connect.ts          # HTTP / stdio 연결
├── probe.ts            # probe 파일 검증과 안전장치
├── format/pretty.ts    # 사람이 읽는 출력
└── rules/
    ├── toolRules.ts      # tools/list 규칙
    ├── responseRules.ts  # probe 규칙
    └── types.ts
tests/
├── fixtures/           # 정상/문제 MCP 서버 (메모리 · stdio · HTTP 공용)
└── *.test.ts
```

<br/>

## 한계

- 지원하는 전송 방식은 Streamable HTTP와 stdio예요. 예전 SSE 방식과 OAuth 로그인은 아직 지원하지 않아요 (헤더로 토큰을 넘기는 건 돼요).
- base64 판정은 휴리스틱이에요. 512자 이상, 대소문자와 숫자가 섞인 문자열만 잡아요.
- 툴 설명이 "충분히 좋은지"는 길이로만 봐요. 실제로 에이전트가 맞는 툴을 고르는지는 LLM으로 평가해야 해서 다음 단계로 남겨 뒀어요.

## License

MIT
