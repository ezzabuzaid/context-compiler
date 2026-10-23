import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// ../elt/packages/codecs/apple-reference-date/dist/reference-date.js
var referenceDateSeconds = 978307200;
var distantPast = -63114076800;
var distantFuture = 63113904e3;
function referenceDateInstant(seconds) {
  const micros = Math.round(seconds * 1e6);
  const whole = Math.floor(micros / 1e6);
  const iso = new Date((whole + referenceDateSeconds) * 1e3).toISOString();
  return `${iso.slice(0, 19)}.${String(micros - whole * 1e6).padStart(6, "0")}Z`;
}
function referenceDate(seconds) {
  return new Date(Math.round((seconds + referenceDateSeconds) * 1e3));
}
function isWithinDistantDates(seconds) {
  return seconds > distantPast && seconds < distantFuture;
}

export {
  referenceDateInstant,
  referenceDate,
  isWithinDistantDates
};
