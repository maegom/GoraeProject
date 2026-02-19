// tools/make-font-base64.js
// 사용: node tools/make-font-base64.js shared/quote/fonts/Pretendard-Regular.ttf shared/quote/fonts/Pretendard-Regular.base64.js

const fs = require("fs");
const [,, inPath, outPath] = process.argv;

if (!inPath || !outPath) {
  console.error("Usage: node make-font-base64.js <in.ttf> <out.js>");
  process.exit(1);
}

const buf = fs.readFileSync(inPath);
const b64 = buf.toString("base64");

// js 파일로 export
const js = `// auto-generated\nwindow.__GE_PDF_FONT_B64__ = "${b64}";\n`;
fs.writeFileSync(outPath, js);

console.log("OK:", outPath);
