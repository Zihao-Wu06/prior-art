/**
 * UserPromptSubmit hook.
 *
 * Nudges toward the reuse ladder when a submitted prompt reads as a build
 * request. Only active when the project's configured sensitivity is
 * 'standard' or 'strict'. Never throws — any failure exits 0 silently.
 */

const BUILD_INTENT_EN =
  /\b(implement|build|creat\w*|add|write|develop|make|code up)\b[\s\S]{0,80}\b(feature|util\w*|helper|client|parser|validator|scheduler|queue|cache|auth|upload|export|integration|component|service|library|wrapper|sdk|cli|api|picker|editor|dashboard)\b/i;

const BUILD_INTENT_ZH =
  /(实现|写一个|做一个|加一个|新增|开发|搭一个|造)[\s\S]{0,30}(功能|工具|组件|服务|客户端|解析|校验|队列|缓存|上传|导出|集成|接口|选择器|面板)/;

const NUDGE =
  "Prior Art gate: before implementing, walk the reuse ladder (built-in → platform → installed capability → existing solution → open source → commercial → in-house) and say which rung you chose. Quick prior-art check first: repo, installed deps, connected MCP servers/skills. State which channels you checked — never claim nothing exists for a channel you didn't search. Vet new dependencies with `pa report <pkg>`.";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const prompt = input.prompt;
  if (!prompt || typeof prompt !== 'string') return;
  if (prompt.startsWith('/')) return;
  if (/prior.?art/i.test(prompt)) return;

  const cwd = input.cwd || process.cwd();
  const { loadConfig } = await import('../src/core/config.js');
  const config = loadConfig(cwd);
  if (config.sensitivity !== 'standard' && config.sensitivity !== 'strict') return;

  if (BUILD_INTENT_EN.test(prompt) || BUILD_INTENT_ZH.test(prompt)) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: NUDGE
      }
    }));
  }
}

try {
  await main();
} catch {
  // Never break the host session.
}
