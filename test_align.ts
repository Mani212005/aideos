const scripted = ["a", "b", "c"];
const times = [
  { startSec: 0, endSec: 0.1 },
  { startSec: 0.1, endSec: 0.15000000000000002 },
  { startSec: 0.1, endSec: 0.2 }
];
const fixup = scripted.map((word, w) => {
  const prevEnd = w > 0 ? Math.max(0, times[w - 1].endSec) : 0;
  const from = Math.max(0, prevEnd, times[w].startSec);
  times[w] = { startSec: from, endSec: Math.max(from + 0.06, times[w].endSec) };
  return { word, startSec: from, endSec: times[w].endSec };
});
console.log(fixup);
