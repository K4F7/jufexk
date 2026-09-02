import { describe, expect, it } from "vitest";
import {
  MIXED_VENUE_WITHHOLD_REASON,
  NO_VENUE_SKILL_WITHHOLD_REASON,
  proposeHistoricalDisposition,
  type PeCloseoutEvidenceItem,
  type PeQueueRow,
} from "../src/lib/pe-queue-closeout";
import {
  aggregateUmbrellaVenueSkills,
  majorityVenueSkill,
  parseInventoryJsonl,
  venueCountsFor,
  venueSkillFromLocation,
} from "../src/lib/pe-venue-evidence";

const FIXTURE_JSONL = `
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["张晓英"],"sourceLocation":"麦篮球场T005(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["张晓英"],"sourceLocation":"麦篮球场T005(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["张晓英"],"sourceLocation":"麦排球场T015(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["张晓英"],"sourceLocation":"麦排球场T015(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["谢辉"],"sourceLocation":"麦跆拳道场T030(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["谢辉"],"sourceLocation":"麦跆拳道场T030(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["谢辉"],"sourceLocation":"麦跆拳道场T030(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["谢辉"],"sourceLocation":"麦跆拳道场T030(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["谢辉"],"sourceLocation":"蛟散打室T025(蛟桥园校区)"}
{"normalizedCourseName":"游泳","normalizedTeacherLabels":["谢辉"],"sourceLocation":"麦游泳馆"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["曹永臻"],"sourceLocation":"麦乒乓球场T020(麦庐园校区)"}
{"normalizedCourseName":"游泳","normalizedTeacherLabels":["曹永臻"],"sourceLocation":"麦游泳馆"}
{"normalizedCourseName":"体育科研方法","normalizedTeacherLabels":["赵翔"],"sourceLocation":"麦二教2107(麦庐园校区)"}
{"normalizedCourseName":"运动生理学","normalizedTeacherLabels":["周进"],"sourceLocation":"麦一教1206(麦庐园校区)"}
{"normalizedCourseName":"军事理论","normalizedTeacherLabels":["李昌卫"],"sourceLocation":"枫青云楼101"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["空地点"],"sourceLocation":""}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["教室课"],"sourceLocation":"麦大活D101(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["付艳"],"sourceLocation":"麦舞蹈房T042(麦庐园校区)"}
{"normalizedCourseName":"体育1","normalizedTeacherLabels":["付艳"],"sourceLocation":"麦瑜伽教室T044(麦庐园校区)"}
{"normalizedCourseName":"国际标准舞Ⅰ","normalizedTeacherLabels":["陈俊文"],"sourceLocation":"麦舞蹈房T042(麦庐园校区)"}
`.trim();

const swimSibling = (label: string): PeCloseoutEvidenceItem => ({
  kind: "catalog_course_name",
  specialization: "游泳",
  sourceCourseCode: "PE-SWIM",
  sourceCourseName: "游泳",
  sourceTeacherLabel: label,
});

const row = (label: string, courseName = "体育1"): PeQueueRow => ({
  courseId: 11,
  teacherId: 22,
  courseCode: "PE-1",
  courseName,
  sourceTeacherLabel: label,
  reason: "umbrella_unmapped",
  disposition: "withheld_permanent_exception",
  dispositionReason: "no explicit specialization evidence at historical closeout",
  disposedBy: "",
  disposedAt: null,
});

describe("catalog inventory venue skills", () => {
  const stats = aggregateUmbrellaVenueSkills(parseInventoryJsonl(FIXTURE_JSONL));

  it("maps venue halls and ignores empty locations, classrooms, and named siblings", () => {
    expect(venueSkillFromLocation("麦篮球场T005(麦庐园校区)")).toBe("篮球");
    expect(venueSkillFromLocation("蛟散打室T025(蛟桥园校区)")).toBe("散打");
    expect(venueSkillFromLocation("麦武术室T037(麦庐园校区)")).toBe("武术");
    expect(venueSkillFromLocation("麦舞蹈房T042(麦庐园校区)")).toBe("体育舞蹈");
    expect(venueSkillFromLocation("麦乒乓球场T020(麦庐园校区)")).toBe("乒乓球");
    expect(venueSkillFromLocation("")).toBeNull();
    expect(venueSkillFromLocation("麦大活D101(麦庐园校区)")).toBeNull();
    expect(venueSkillFromLocation("麦二教2107(麦庐园校区)")).toBeNull();
    expect(majorityVenueSkill({ 篮球: 24, 排球: 24 })).toBeNull();
    expect(majorityVenueSkill({ 跆拳道: 4, 散打: 1 })).toMatchObject({
      skill: "跆拳道",
      share: 0.8,
    });
    expect(stats.get("谢辉\t体育1")?.counts).toEqual({ 跆拳道: 4, 散打: 1 });
    expect(stats.get("曹永臻\t体育1")?.counts).toEqual({ 乒乓球: 1 });
    expect(stats.has("谢辉\t游泳")).toBe(false);
    expect(stats.has("赵翔\t体育科研方法")).toBe(false);
    expect(stats.has("陈俊文\t国际标准舞Ⅰ")).toBe(false);
    expect(stats.has("空地点\t体育1")).toBe(false);
    expect(stats.has("教室课\t体育1")).toBe(false);
  });

  it("withholds 张晓英 50/50 篮球场/排球场 instead of guessing", () => {
    const withheld = proposeHistoricalDisposition({
      row: row("张晓英"),
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "篮球",
          sourceCourseCode: "PE-B",
          sourceCourseName: "篮球",
          sourceTeacherLabel: "张晓英",
        },
        {
          kind: "catalog_course_name",
          specialization: "排球",
          sourceCourseCode: "PE-V",
          sourceCourseName: "排球",
          sourceTeacherLabel: "张晓英",
        },
      ],
      venueSkillCounts: venueCountsFor(stats, "张晓英", "体育1"),
    });
    expect(withheld.disposition).toBe("withheld_permanent_exception");
    expect(withheld.specialization).toBeNull();
    expect(withheld.mapping).toBeNull();
    expect(withheld.reason).toContain(MIXED_VENUE_WITHHOLD_REASON);
    expect(withheld.reason).toContain("篮球 2");
    expect(withheld.reason).toContain("排球 2");
  });

  it("maps 谢辉 umbrellas to 跆拳道 from 跆拳道场, not sibling 游泳", () => {
    const mapped = proposeHistoricalDisposition({
      row: { ...row("谢辉"), disposition: "conflict_recapture" },
      evidence: [
        swimSibling("谢辉"),
        {
          kind: "catalog_course_name",
          specialization: "跆拳道",
          sourceCourseCode: "PE-TKD",
          sourceCourseName: "跆拳道",
          sourceTeacherLabel: "谢辉",
        },
      ],
      venueSkillCounts: venueCountsFor(stats, "谢辉", "体育1"),
    });
    expect(mapped).toMatchObject({
      disposition: "mapped",
      specialization: "跆拳道",
    });
    expect(mapped.mapping?.evidence.kind).toBe("inventory_venue");
    expect(mapped.reason).toContain("inventory_venue:跆拳道");
    expect(mapped.reason).not.toContain("游泳");
  });

  it("maps 曹永臻 umbrellas to 乒乓球 from 乒乓球场, not sibling 游泳", () => {
    const mapped = proposeHistoricalDisposition({
      row: {
        ...row("曹永臻"),
        disposition: "mapped",
        dispositionReason: "catalog_course_name:游泳",
      },
      evidence: [swimSibling("曹永臻")],
      currentSpecialization: "游泳",
      venueSkillCounts: venueCountsFor(stats, "曹永臻", "体育1"),
    });
    expect(mapped).toMatchObject({
      disposition: "mapped",
      specialization: "乒乓球",
      currentSpecialization: "游泳",
    });
    expect(mapped.mapping?.normalizedSpecialization).toBe("乒乓球");
    expect(mapped.reason).not.toContain("游泳");
  });

  it("does not map theory siblings or classroom locations onto 体育1–4", () => {
    const theory = proposeHistoricalDisposition({
      row: row("赵翔"),
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "体育科研方法",
          sourceCourseCode: "PE-RES",
          sourceCourseName: "体育科研方法",
          sourceTeacherLabel: "赵翔",
        },
        {
          kind: "catalog_course_name",
          specialization: "游泳",
          sourceCourseCode: "PE-SWIM",
          sourceCourseName: "游泳",
          sourceTeacherLabel: "赵翔",
        },
        {
          kind: "catalog_course_name",
          specialization: "田径",
          sourceCourseCode: "PE-TRACK",
          sourceCourseName: "田径1（体适能为主）",
          sourceTeacherLabel: "赵翔",
        },
      ],
      venueSkillCounts: venueCountsFor(stats, "赵翔", "体育1"),
    });
    expect(theory.disposition).toBe("withheld_permanent_exception");
    expect(theory.specialization).toBeNull();
    expect(theory.reason).toBe(NO_VENUE_SKILL_WITHHOLD_REASON);

    const classroom = proposeHistoricalDisposition({
      row: row("教室课"),
      evidence: [],
      venueSkillCounts: venueCountsFor(stats, "教室课", "体育1"),
    });
    expect(classroom.disposition).toBe("withheld_permanent_exception");
    expect(classroom.specialization).toBeNull();

    const dance = proposeHistoricalDisposition({
      row: row("付艳"),
      evidence: [
        {
          kind: "catalog_course_name",
          specialization: "国际标准舞",
          sourceCourseCode: "PE-STD",
          sourceCourseName: "国际标准舞Ⅰ",
          sourceTeacherLabel: "付艳",
        },
      ],
      venueSkillCounts: { 体育舞蹈: 224, 瑜伽: 16 },
    });
    expect(dance).toMatchObject({
      disposition: "mapped",
      specialization: "体育舞蹈",
    });
    expect(dance.reason).not.toContain("国际标准舞");
  });
});
