const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');

console.log("=== OCCURRENCES OF Gagal membuat ===");
lines.forEach((line, idx) => {
  if (line.includes('Gagal membuat kelengkapan') || line.includes('Gagal menghasilkan kelengkapan') || line.includes('Gagal membuat')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
