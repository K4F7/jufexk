/** 写评价表的学期选项：当前学期起往前 8 个学期（春/秋）。 */
export function recentTerms(now = new Date()): string[] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // 2–7 月按春季学期段，8 月到次年 1 月按秋季学期段。
  let y = year;
  let season = month >= 2 && month <= 7 ? "春" : "秋";
  const terms: string[] = [];
  for (let i = 0; i < 8; i++) {
    terms.push(`${y}${season}`);
    if (season === "秋") {
      season = "春";
    } else {
      season = "秋";
      y -= 1;
    }
  }
  return terms;
}
