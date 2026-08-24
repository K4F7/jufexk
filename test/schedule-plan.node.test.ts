import { describe, expect, it } from "vitest";
import {
  buildOccupied,
  canAddSlot,
  cellHasConflict,
  conflictMessage,
  defaultWeeks,
  listConflicts,
  normalizeSlot,
  periodRange,
  stagedCourseId,
  stagedCourseName,
  weeksIntersect,
  type StagedCourse,
} from "../src/lib/schedule-plan";

const weeks = defaultWeeks();

function course(
  id: string,
  name: string,
  teacher: string,
  slots: Array<{ weekday: number; start: number; end: number }>,
): StagedCourse {
  const [courseId, teacherId] = id.split(":").map(Number);
  return {
    id,
    courseId,
    courseCode: `C${courseId}`,
    courseName: name,
    teacherId,
    teacherName: teacher,
    rating: 4,
    reviewCount: 3,
    slots: slots.map((slot) =>
      normalizeSlot({
        id: `${id}-${slot.weekday}-${slot.start}`,
        weekday: slot.weekday,
        startPeriod: slot.start,
        endPeriod: slot.end,
        weeks,
      }),
    ),
  };
}

describe("schedule-plan helpers", () => {
  it("builds a staged course key from 课程×教师", () => {
    expect(stagedCourseId(8, 9)).toBe("8:9");
    expect(stagedCourseId(8, null)).toBe("8:0");
  });

  it("expands a period range inclusively", () => {
    expect(periodRange(1, 2)).toEqual([1, 2]);
    expect(periodRange(4, 2)).toEqual([2, 3, 4]);
  });

  it("detects intersecting weeks", () => {
    expect(weeksIntersect([1, 2, 3], [3, 4])).toBe(true);
    expect(weeksIntersect([1, 2], [3, 4])).toBe(false);
  });
});

describe("canAddSlot", () => {
  it("allows a free weekday-period cell", () => {
    const occupied = buildOccupied([
      course("1:1", "高等数学", "张三", [{ weekday: 1, start: 1, end: 2 }]),
    ]);
    expect(
      canAddSlot(
        occupied,
        normalizeSlot({
          weekday: 2,
          startPeriod: 1,
          endPeriod: 2,
          weeks,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects the same weekday-period when weeks overlap", () => {
    const occupied = buildOccupied([
      course("1:1", "高等数学", "张三", [{ weekday: 1, start: 1, end: 2 }]),
    ]);
    expect(
      canAddSlot(
        occupied,
        normalizeSlot({
          weekday: 1,
          startPeriod: 2,
          endPeriod: 3,
          weeks,
        }),
      ),
    ).toEqual({ ok: false, collideName: "高等数学（张三）" });
  });

  it("allows the same cell when weeks do not intersect", () => {
    const oddWeeksCourse = course("1:1", "高等数学", "张三", [
      { weekday: 1, start: 1, end: 2 },
    ]);
    oddWeeksCourse.slots[0].weeks = [1, 3, 5];
    expect(
      canAddSlot(
        buildOccupied([oddWeeksCourse]),
        normalizeSlot({
          weekday: 1,
          startPeriod: 1,
          endPeriod: 2,
          weeks: [2, 4, 6],
        }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("listConflicts", () => {
  it("names two courses that share a period and weeks", () => {
    const conflicts = listConflicts([
      course("1:1", "高等数学", "张三", [{ weekday: 1, start: 1, end: 2 }]),
      course("2:2", "线性代数", "李四", [{ weekday: 1, start: 2, end: 3 }]),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflictMessage(conflicts[0])).toBe(
      "高等数学（张三）与线性代数（李四）在周一第2节冲突",
    );
    const occupied = buildOccupied([
      course("1:1", "高等数学", "张三", [{ weekday: 1, start: 1, end: 2 }]),
      course("2:2", "线性代数", "李四", [{ weekday: 1, start: 2, end: 3 }]),
    ]);
    expect(cellHasConflict(occupied[1][0])).toBe(true);
  });

  it("does not flag different weekdays", () => {
    expect(
      listConflicts([
        course("1:1", "高等数学", "张三", [{ weekday: 1, start: 1, end: 2 }]),
        course("2:2", "线性代数", "李四", [{ weekday: 3, start: 1, end: 2 }]),
      ]),
    ).toEqual([]);
  });

  it("formats the public display name", () => {
    expect(stagedCourseName({ courseName: "高等数学", teacherName: null })).toBe(
      "高等数学",
    );
  });
});
