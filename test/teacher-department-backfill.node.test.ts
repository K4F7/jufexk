import { describe, expect, it } from "vitest";
import {
  catalogDepartmentLabels,
  mapCtaDeptNameToCatalog,
  planTeacherDepartmentBackfill,
  storedDepartmentIsEmpty,
  summarizeTeacherDepartmentBackfill,
  uniqueCatalogTeacherDepartment,
} from "../src/teacher-department-backfill";
import { departmentUpdateStatements } from "../scripts/teacher-department-backfill/apply-remote";

const catalogLabels = [
  "会计学院",
  "马克思主义学院",
  "计算机与人工智能学院",
  "金融学院",
];

describe("teacher department backfill matching", () => {
  it("treats null, empty, and whitespace departments as unlabeled", () => {
    expect(storedDepartmentIsEmpty(null)).toBe(true);
    expect(storedDepartmentIsEmpty("")).toBe(true);
    expect(storedDepartmentIsEmpty("   ")).toBe(true);
    expect(storedDepartmentIsEmpty("马克思主义学院")).toBe(false);
  });

  it("keeps a unique JWXT 承担单位 after stripping unit codes", () => {
    expect(
      uniqueCatalogTeacherDepartment([
        "[121]马克思主义学院",
        "  [121]马克思主义学院  ",
        "马克思主义学院",
      ]),
    ).toBe("马克思主义学院");
  });

  it("skips catalog when a teacher has more than one home unit", () => {
    expect(
      uniqueCatalogTeacherDepartment([
        "[121]马克思主义学院",
        "[040]会计学院",
      ]),
    ).toBeNull();
    expect(uniqueCatalogTeacherDepartment([])).toBeNull();
    expect(uniqueCatalogTeacherDepartment(["", null])).toBeNull();
  });

  it("maps CTA deptName onto the catalog college vocabulary", () => {
    expect(
      mapCtaDeptNameToCatalog(
        "马克思主义学院、中国特色社会主义理论体系研究中心",
        catalogLabels,
      ),
    ).toBe("马克思主义学院");
    expect(
      mapCtaDeptNameToCatalog(
        "计算机与人工智能学院（格里菲斯数智学院）、财经大数据教育部工程研究中心",
        catalogLabels,
      ),
    ).toBe("计算机与人工智能学院");
  });

  it("falls back to the normalized CTA name when no catalog college matches", () => {
    expect(mapCtaDeptNameToCatalog("区域国别研究院", catalogLabels)).toBe(
      "区域国别研究院",
    );
    expect(mapCtaDeptNameToCatalog("", catalogLabels)).toBeNull();
  });

  it("fills unlabeled teachers from a unique catalog unit and skips nonempty rows", () => {
    const fills = planTeacherDepartmentBackfill(
      [
        {
          id: 923,
          name: "李德满",
          department: null,
          courseDepartments: ["[121]马克思主义学院"],
        },
        {
          id: 2,
          name: "已有院系",
          department: "会计学院",
          courseDepartments: ["[143]计算机与人工智能学院"],
        },
        {
          id: 3,
          name: "空白院系",
          department: "  ",
          courseDepartments: ["[040]会计学院"],
        },
      ],
      [
        {
          uid: 1,
          realname: "李德满",
          photo: null,
          deptName: "不该用的CTA院系",
        },
      ],
      catalogLabels,
    );
    expect(fills).toEqual([
      { teacherId: 923, department: "马克思主义学院", source: "catalog" },
      { teacherId: 3, department: "会计学院", source: "catalog" },
    ]);
  });

  it("uses CTA only when the JWXT catalog has no unique department", () => {
    const fills = planTeacherDepartmentBackfill(
      [
        {
          id: 10,
          name: "跨院教师",
          department: null,
          courseDepartments: ["[121]马克思主义学院", "[040]会计学院"],
        },
        {
          id: 11,
          name: "无课教师",
          department: null,
          courseDepartments: [],
        },
        {
          id: 12,
          name: "无来源教师",
          department: null,
          courseDepartments: ["[040]会计学院", "[042]金融学院"],
        },
      ],
      [
        {
          uid: 100,
          realname: "跨院教师",
          photo: null,
          deptName: "会计学院、某研究中心",
        },
        {
          uid: 101,
          realname: "无课教师",
          photo: null,
          deptName: "金融学院",
        },
      ],
      catalogLabels,
    );
    expect(fills).toEqual([
      { teacherId: 10, department: "会计学院", source: "cta" },
      { teacherId: 11, department: "金融学院", source: "cta" },
    ]);
  });

  it("does not guess an ambiguous CTA name when catalog is empty", () => {
    const fills = planTeacherDepartmentBackfill(
      [
        {
          id: 20,
          name: "张强",
          department: null,
          courseDepartments: [],
        },
      ],
      [
        { uid: 1, realname: "张强", photo: null, deptName: "计算机与人工智能学院" },
        { uid: 2, realname: "张强", photo: null, deptName: "金融学院" },
      ],
      catalogLabels,
    );
    expect(fills).toEqual([]);
  });

  it("summarizes catalog vs CTA fills and remaining unlabeled teachers", () => {
    const teachers = [
      { id: 1, name: "甲", department: null, courseDepartments: ["会计学院"] },
      { id: 2, name: "乙", department: "", courseDepartments: [] },
      { id: 3, name: "丙", department: "金融学院", courseDepartments: [] },
      { id: 4, name: "丁", department: null, courseDepartments: [] },
    ];
    const fills = [
      { teacherId: 1, department: "会计学院", source: "catalog" as const },
      { teacherId: 2, department: "金融学院", source: "cta" as const },
    ];
    expect(summarizeTeacherDepartmentBackfill(teachers, fills)).toEqual({
      teachers: 4,
      unlabeledBefore: 3,
      unlabeledAfter: 1,
      filled: 2,
      filledFromCatalog: 1,
      filledFromCta: 1,
    });
    expect(catalogDepartmentLabels(["[040]会计学院", "[040]会计学院"])).toEqual([
      "会计学院",
    ]);
  });

  it("updates only empty departments in generated D1 SQL", () => {
    const sql = departmentUpdateStatements([
      { teacherId: 923, department: "马克思主义学院", source: "catalog" },
      { teacherId: 11, department: "O'Reilly院", source: "cta" },
    ]);
    expect(sql[0]).toContain("department='马克思主义学院'");
    expect(sql[0]).toContain("id=923");
    expect(sql[0]).toContain("trim(COALESCE(department,''))=''");
    expect(sql[1]).toContain("department='O''Reilly院'");
  });
});
