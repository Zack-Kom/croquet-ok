#!/usr/bin/env node
// Extracts the monolithic index.html into a proper Vite project structure.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'src');
const PUB  = path.join(ROOT, 'public', 'scenes');

fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(PUB, { recursive: true });

console.log('Reading index.html...');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lines = html.split('\n');

// ── 1. Extract <style> block ──────────────────────────────────────────────────
const styleStart = lines.findIndex(l => l.trim() === '<style>');
const styleEnd   = lines.findIndex(l => l.trim() === '</style>');
let css = '';
if (styleStart !== -1 && styleEnd !== -1) {
  css = lines.slice(styleStart + 1, styleEnd).join('\n');
  console.log(`Extracted CSS: lines ${styleStart + 1}–${styleEnd} (${css.length} chars)`);
} else {
  console.warn('No <style> block found');
}

// ── 2. Extract main <script> block (the one without src=) ────────────────────
// Find the large inline script (after </head>)
let scriptStart = -1;
let scriptEnd   = -1;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === '<script>' && i > 530) { scriptStart = i; break; }
}
for (let i = lines.length - 1; i >= 0; i--) {
  const t = lines[i].trim();
  if (t === '</script>') { scriptEnd = i; break; }
}
if (scriptStart === -1 || scriptEnd === -1) {
  console.error('Could not find main script block'); process.exit(1);
}
console.log(`Extracted script: lines ${scriptStart + 1}–${scriptEnd} (${scriptEnd - scriptStart} lines)`);
let jsCode = lines.slice(scriptStart + 1, scriptEnd).join('\n');

// ── 3. Extract <head> constants (lines 1–529, inside first <script> block) ───
const headScriptStart = lines.findIndex(l => l.trim().startsWith('<script>'));
const headScriptEnd   = lines.findIndex((l, i) => i > headScriptStart && l.trim() === '</script>');
let headScript = '';
if (headScriptStart !== -1 && headScriptEnd !== -1 && headScriptStart < 100) {
  headScript = lines.slice(headScriptStart + 1, headScriptEnd).join('\n');
  console.log(`Extracted head script: lines ${headScriptStart + 1}–${headScriptEnd}`);
}

// ── 4. Extract base64 scene images ───────────────────────────────────────────
const imgPattern = /const (\w+)\s*=\s*["']data:image\/webp;base64,([A-Za-z0-9+/=\r\n]+)["']/g;
const imgMap = {};
let match;
const fullCode = headScript + '\n' + jsCode;

console.log('Scanning for base64 images...');
let searchCode = fullCode;
const simplePattern = /const (\w+)\s*=\s*["']data:image\/(webp|png|jpeg|jpg);base64,/g;
let simpleMatch;
while ((simpleMatch = simplePattern.exec(searchCode)) !== null) {
  const constName = simpleMatch[1];
  const mimeType  = simpleMatch[2];
  const startIdx  = simpleMatch.index + simpleMatch[0].length;
  // Find end of the base64 string (next quote not preceded by \)
  let endIdx = startIdx;
  const quoteChar = searchCode[simpleMatch.index + simpleMatch[0].length - 1 - 1] === '"' ? '"' : "'";
  // The opening quote is just before base64 data
  // Walk forward to find closing quote
  let depth = 0;
  for (let k = startIdx; k < searchCode.length; k++) {
    if (searchCode[k] === '"' || searchCode[k] === "'") {
      endIdx = k;
      break;
    }
  }
  if (endIdx === startIdx) continue;

  const b64 = searchCode.slice(startIdx, endIdx).replace(/\s/g, '');
  const filename = constName.toLowerCase().replace(/_img$/, '').replace(/_/g, '-') + '.' + (mimeType === 'jpeg' ? 'jpg' : mimeType);
  const outPath  = path.join(PUB, filename);
  try {
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    const kb = Math.round(fs.statSync(outPath).size / 1024);
    imgMap[constName] = `/scenes/${filename}`;
    console.log(`  ✓ ${constName} → /scenes/${filename} (${kb} KB)`);
  } catch (e) {
    console.warn(`  ✗ Failed to decode ${constName}: ${e.message}`);
  }
}

// ── 5. Replace base64 image consts with URL strings ──────────────────────────
for (const [constName, urlPath] of Object.entries(imgMap)) {
  // Replace the full const declaration with a short URL string
  const replacePattern = new RegExp(
    `const ${constName}\\s*=\\s*["']data:image/[^;]+;base64,[A-Za-z0-9+/=\\s]+["']`,
    'g'
  );
  jsCode     = jsCode.replace(replacePattern,     `const ${constName} = "${urlPath}"`);
  headScript = headScript.replace(replacePattern, `const ${constName} = "${urlPath}"`);
}

// ── 6. Remove the ReactDOM.createRoot mount (goes in main.jsx instead) ───────
jsCode = jsCode.replace(
  /\/\/ Mount the app[\s\S]*?root\.render\(React\.createElement\(App\)\);?\s*/,
  ''
);

// Remove CDN-style global references (React, ReactDOM are now imports)
// Keep the code as-is — globals still work with Vite's define if needed,
// but we'll add proper imports in main.jsx / App.jsx header

// ── 7. Write src/index.css ───────────────────────────────────────────────────
fs.writeFileSync(path.join(SRC, 'index.css'), css);
console.log('Wrote src/index.css');

// ── 8. Write src/App.jsx ─────────────────────────────────────────────────────
const appHeader = `import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
`;

// Combine head constants + main script, wrapping in proper module
const appContent = appHeader + '\n' + headScript + '\n\n' + jsCode + '\n\nexport default App;\n';
fs.writeFileSync(path.join(SRC, 'App.jsx'), appContent);
console.log(`Wrote src/App.jsx (${Math.round(appContent.length / 1024)} KB)`);

// ── 9. Write src/main.jsx ────────────────────────────────────────────────────
const mainContent = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(App)
);
`;
fs.writeFileSync(path.join(SRC, 'main.jsx'), mainContent);
console.log('Wrote src/main.jsx');

// ── 10. Write new index.html ──────────────────────────────────────────────────
// Extract <head> meta/link tags (excluding script tags and style tag)
const metaLines = [];
let inStyle = false;
let inScript = false;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === '<style>') { inStyle = true; continue; }
  if (t === '</style>') { inStyle = false; continue; }
  if (t.startsWith('<script')) { inScript = true; continue; }
  if (t === '</script>') { inScript = false; continue; }
  if (inStyle || inScript) continue;
  if (i === 0 || t === '<html lang="en">' || t === '<head>' || t === '</head>' ||
      t === '<body>' || t === '</body>' || t === '</html>' ||
      t === '<!DOCTYPE html>' || t.startsWith('<div id="root"') || t === '') continue;
  if (t.startsWith('<meta') || t.startsWith('<link') || t.startsWith('<title')) {
    metaLines.push('    ' + t);
  }
}

const newHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
${metaLines.join('\n')}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, 'index.html'), newHtml);
console.log('Wrote index.html (Vite entry)');

console.log('\n✅ Extraction complete!');
console.log(`   Images extracted: ${Object.keys(imgMap).length}`);
console.log('   Next: npm install && npm run dev');
