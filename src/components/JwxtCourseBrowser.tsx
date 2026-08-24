import { Button, Label, ListBox, Select, Table, Tabs } from "@heroui/react";
import type { JwxtFilterOption, JwxtOffering } from "../lib/jwxt-offering";
import { offeringKey } from "../lib/jwxt-offering";
import { findSameCourse, type PlannedItem } from "../lib/jwxt-plan";
import type { JwxtSnapshotV1 } from "../lib/jwxt-snapshot";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: JwxtFilterOption[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <Select
      className="min-w-36"
      variant="secondary"
      value={value}
      onChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function OfferingTable({
  label,
  offerings,
  termId,
  planItems,
  canEdit,
  mode,
  onJoin,
  onToggle,
}: {
  label: string;
  offerings: JwxtOffering[];
  termId: string;
  planItems: PlannedItem[];
  canEdit: boolean;
  mode: "enrolled" | "candidate";
  onJoin: (offering: JwxtOffering) => void;
  onToggle: (item: PlannedItem, included: boolean) => void;
}) {
  return (
    <div>
      {offerings.length === 0 ? (
        <p className="mb-2 text-sm text-muted" role="status">
          这一类还没有课程。
        </p>
      ) : null}
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label} className="w-full min-w-0">
          <Table.Header>
            <Table.Column isRowHeader>课程</Table.Column>
            <Table.Column>教师 / 班号</Table.Column>
            <Table.Column>时间</Table.Column>
            <Table.Column>操作</Table.Column>
          </Table.Header>
          <Table.Body>
            {offerings.map((offering, index) => {
                const key = offeringKey(termId, offering.courseCode, offering.section);
                const existing = planItems.find((item) => item.key === key);
                const sameCourse = findSameCourse(planItems, offering.courseCode);
                const title = offering.teacherName
                  ? `${offering.courseName}（${offering.teacherName}）`
                  : offering.courseName;
                return (
                  <Table.Row key={key || `${label}-${index}`} id={key || `${label}-${index}`}>
                    <Table.Cell>
                      <div className="font-medium">{title}</div>
                      <div className="text-sm text-muted">
                        {offering.courseCode}
                        {offering.credits != null ? ` · ${offering.credits} 学分` : ""}
                        {offering.categoryPath ? ` · ${offering.categoryPath}` : ""}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div>{offering.section || "—"}</div>
                      <div className="text-sm text-muted">{offering.campus || offering.place || "—"}</div>
                    </Table.Cell>
                    <Table.Cell>
                      <div>{offering.timeText || "无固定时间"}</div>
                      <div className="text-sm text-muted">{offering.weekText || "—"}</div>
                    </Table.Cell>
                    <Table.Cell>
                      {mode === "enrolled" ? (
                        <Button
                          size="sm"
                          variant={existing?.included === false ? "secondary" : "ghost"}
                          onPress={() => {
                            if (!canEdit || !existing) return;
                            onToggle(existing, !existing.included);
                          }}
                        >
                          {existing?.included === false ? "恢复" : "排除"}
                        </Button>
                      ) : existing ? (
                        <Button size="sm" variant="secondary" isDisabled>
                          已加入
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            if (!canEdit) return;
                            onJoin(offering);
                          }}
                        >
                          {sameCourse ? "换班" : "加入课表"}
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
    </div>
  );
}

export function JwxtCourseBrowser({
  snapshot,
  planItems,
  canEdit,
  onFilters,
  onJoin,
  onToggle,
}: {
  snapshot: JwxtSnapshotV1;
  planItems: PlannedItem[];
  canEdit: boolean;
  onFilters: (patch: Partial<Pick<JwxtSnapshotV1, "term" | "educationLevel" | "grade" | "major">>) => void;
  onJoin: (offering: JwxtOffering, origin: "planned" | "public") => void;
  onToggle: (item: PlannedItem, included: boolean) => void;
}) {
  const termId = snapshot.term.id;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          label="学期"
          value={snapshot.term.id}
          options={snapshot.terms}
          onChange={(id) => {
            const term = snapshot.terms.find((item) => item.id === id);
            if (term) onFilters({ term });
          }}
        />
        <FilterSelect
          label="培养层次"
          value={snapshot.educationLevel.id}
          options={snapshot.educationLevels}
          onChange={(id) => {
            const educationLevel = snapshot.educationLevels.find((item) => item.id === id);
            if (educationLevel) onFilters({ educationLevel });
          }}
        />
        <FilterSelect
          label="年级"
          value={snapshot.grade.id}
          options={snapshot.grades}
          onChange={(id) => {
            const grade = snapshot.grades.find((item) => item.id === id);
            if (grade) onFilters({ grade });
          }}
        />
        <FilterSelect
          label="专业"
          value={snapshot.major.id}
          options={snapshot.majors}
          onChange={(id) => {
            const major = snapshot.majors.find((item) => item.id === id);
            if (major) onFilters({ major });
          }}
        />
      </div>
      <Tabs defaultSelectedKey="enrolled">
        <Tabs.ListContainer>
          <Tabs.List aria-label="教务课程分类">
            <Tabs.Tab id="enrolled">
              已选
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="planned">
              <Tabs.Separator />
              计划内
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="public">
              <Tabs.Separator />
              公共选修
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel className="pt-3" id="enrolled">
          <OfferingTable
            label="已选课程"
            mode="enrolled"
            offerings={snapshot.enrolled}
            termId={termId}
            planItems={planItems}
            canEdit={canEdit}
            onJoin={() => {}}
            onToggle={onToggle}
          />
        </Tabs.Panel>
        <Tabs.Panel className="pt-3" id="planned">
          <OfferingTable
            label="计划内课程"
            mode="candidate"
            offerings={snapshot.planned}
            termId={termId}
            planItems={planItems}
            canEdit={canEdit}
            onJoin={(offering) => onJoin(offering, "planned")}
            onToggle={onToggle}
          />
        </Tabs.Panel>
        <Tabs.Panel className="pt-3" id="public">
          <OfferingTable
            label="公共选修"
            mode="candidate"
            offerings={snapshot.publicElectives}
            termId={termId}
            planItems={planItems}
            canEdit={canEdit}
            onJoin={(offering) => onJoin(offering, "public")}
            onToggle={onToggle}
          />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
