// dsh-livefeed lib 生成脚本：从 src/host/plugin.js 与 src/client/plugin.js 提取 apply 体，
// 包装为 bundle 插件格式（lib/index.mjs + lib/client.js）。用法：npm run build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function extractApply(src) {
  const m = src.match(/apply\(ctx\) \{\n([\s\S]*)\n  \},\n\};$/);
  if (!m) throw new Error('apply body not found');
  return m[1];
}

const host = readFileSync(join(root, 'src', 'host', 'plugin.js'), 'utf8');
const client = readFileSync(join(root, 'src', 'client', 'plugin.js'), 'utf8');

mkdirSync(join(root, 'lib'), { recursive: true });

writeFileSync(
  join(root, 'lib', 'index.mjs'),
  `const name = "dsh-livefeed";\nconst inject = ["timer", "web", "llm", "fs", "agentDefaultModel", "webServer"];\nfunction apply(ctx) {\n${extractApply(host)}\n}\nexport { apply, inject, name };\n`
);

writeFileSync(
  join(root, 'lib', 'client.js'),
  `window.__ModuleLoader__.load({\n\tid: "@dsh-external/dsh-livefeed",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tconst React = require("react");\n\t\tmodule.exports = {\n\t\t\tname: "livefeed-client",\n\t\t\tinject: ["timer"],\n\t\t\tapply(ctx) {\n${extractApply(client)}\n\t\t\t}\n\t\t};\n\t\treturn module.exports;\n\t}\n});\n`
);

console.log('lib generated (index.mjs + client.js)');
