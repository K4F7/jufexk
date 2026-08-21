const base = "https://xk.sein.moe";
const counts = {
  major: 0,
  ideology: 0,
  math: 0,
  public_basic: 0,
  english: 0,
  pe: 0,
  other: 0,
  mooc: 0,
  moocMissingAttendanceSkip: 0,
  moocStillHasAttendance: [],
  unsetish: [],
};
let page = 1;
let pages = 1;
let total = 0;
const samples = { ideology: [], math: [], english: [], pe: [], public_basic: [], mooc: [] };
while (page <= pages) {
  const response = await fetch(`${base}/api/courses/options?page=${page}&size=100`);
  const body = await response.json();
  pages = body.pages;
  total = body.total;
  for (const item of body.items || []) {
    const key = item.schemeKey || "other";
    counts[key] = (counts[key] || 0) + 1;
    const tags = item.tags || [];
    if (tags.includes("mooc")) {
      counts.mooc += 1;
      const ids = (item.applicableQuestions || []).map((q) => q.id);
      if (ids.includes("attendance")) counts.moocStillHasAttendance.push(item.name);
      else counts.moocMissingAttendanceSkip += 1;
      if (samples.mooc.length < 8) samples.mooc.push({ name: item.name, schemeKey: key, questions: ids });
    }
    if (samples[key] && samples[key].length < 5) {
      samples[key].push({ name: item.name, tags, questions: (item.applicableQuestions || []).map((q) => q.id) });
    }
    if (!item.schemeKey) counts.unsetish.push(item.code);
  }
  page += 1;
}
console.log(JSON.stringify({ total, pages, counts, samples }, null, 2));
