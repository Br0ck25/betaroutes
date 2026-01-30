const fs = require('fs');
const path = 'src/lib/server/TripIndexDO.ts';
const s = fs.readFileSync(path, 'utf8');
const lines = s.split('\n');
let bal = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const c of line) {
    if (c === '{') bal++;
    else if (c === '}') bal--;
  }
  if (bal < 0) {
    console.log('Negative balance at line', i + 1);
    break;
  }
}
console.log('final balance', bal);
for (let i = 0; i < lines.length; i++) {
  if (/compute-routes/.test(lines[i])) console.log('compute-routes at line', i + 1);
}

// Print balance per line for debugging
let running = 0;
const stack = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const c of line) {
    if (c === '{') {
      running++;
      stack.push(i + 1);
    } else if (c === '}') {
      running--;
      stack.pop();
    }
  }
  if (running !== 0 && i > lines.length - 200) {
    console.log('line', i + 1, 'balance', running, ':', line.trim().slice(0, 200));
  }
}
if (stack.length > 0) console.log('unmatched-opening-lines (last 10):', stack.slice(-10));

// Print a window around the final few lines for inspection
for (let i = Math.max(0, lines.length - 60); i < lines.length; i++) {
  console.log(i + 1 + ': ' + lines[i]);
}
