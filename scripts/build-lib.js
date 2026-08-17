// dsh-livefeed lib 生成脚本：从 src/host/plugin.js 与 src/client/plugin.js 提取 apply 体，
// 包装为 bundle 插件格式（lib/index.mjs + lib/client.js）。用法：npm run build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function extractApply(src) {
  // 兼容 Windows CRLF；JS 正则 $ 需绝对结尾，去掉尾部空白/换行
  const s = src.replace(/\r\n/g, '\n').replace(/[ \t\n]+$/, '');
  const m = s.match(/apply\(ctx\) \{\n([\s\S]*)\n  \},\n\};$/);
  if (!m) throw new Error('apply body not found');
  return m[1];
}

const host = readFileSync(join(root, 'src', 'host', 'plugin.js'), 'utf8');
const client = readFileSync(join(root, 'src', 'client', 'plugin.js'), 'utf8');
// 把基类模板内嵌为内置常量：新安装无需手动放置 sources/_template.js 即可运行
// （运行目录存在同名文件且含调度器标记时仍优先使用文件版本）。
const template = readFileSync(join(root, 'src', 'template', 'template.js'), 'utf8');
const BUILTIN_TEMPLATE_B64 = Buffer.from(template, 'utf8').toString('base64');

mkdirSync(join(root, 'lib'), { recursive: true });

function buildHost() {
  const body = extractApply(host).replace(
    /const BUILTIN_TEMPLATE = '';/,
    `const BUILTIN_TEMPLATE = atob('${BUILTIN_TEMPLATE_B64}');`,
  );
  if (body.indexOf('BUILTIN_TEMPLATE = atob') < 0) throw new Error('BUILTIN_TEMPLATE 占位符未找到');
  return body;
}

writeFileSync(
  join(root, 'lib', 'index.mjs'),
  `const name = "dsh-livefeed";\nconst inject = ["timer", "web", "llm", "fs", "agentDefaultModel", "webServer"];\nfunction apply(ctx) {\n${buildHost()}\n}\nexport { apply, inject, name };\n`
);

writeFileSync(
  join(root, 'lib', 'client.js'),
  `window.__ModuleLoader__.load({\n\tid: "@dsh-external/dsh-livefeed",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tconst React = require("react");\n\t\tmodule.exports = {\n\t\t\tname: "livefeed-client",\n\t\t\tinject: ["timer"],\n\t\t\tapply(ctx) {\n${extractApply(client)}\n\t\t\t}\n\t\t};\n\t\treturn module.exports;\n\t}\n});\n`
);

console.log('lib generated (index.mjs + client.js)');
