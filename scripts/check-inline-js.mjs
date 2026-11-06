import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("index.html", "utf8");
const tags = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)];
let checked = 0;
const errors = [];
for (let i = 0; i < tags.length; i++) {
  const attrs = tags[i][1] || "";
  const code = tags[i][2] || "";
  if (/\\bsrc\\s*=/.test(attrs)) continue;
  const type = (attrs.match(/\\btype\\s*=\\s*["']?([^"'\\s>]+)/i)?.[1] || "").toLowerCase();
  if (type === "module" || (type && !["text/javascript", "application/javascript"].includes(type))) continue;
  if (!code.trim()) continue;
  checked++;
  try {
    new vm.Script(code, { filename: `index.html:inline-script-${i + 1}` });
  } catch (error) {
    errors.push({ script: i + 1, message: error.message });
  }
}
if (errors.length) {
  for (const error of errors) process.stderr.write(`Inline script ${error.script}: ${error.message}\\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${checked} inline JavaScript blocks; no syntax errors.\\n`);
}
