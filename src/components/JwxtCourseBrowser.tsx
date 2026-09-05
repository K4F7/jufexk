import { Alert, Button, Card, ComboBox, Input, Label, ListBox, Modal, Select, Table, Tabs, Typography } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { relationDetailHref } from "./CourseRelationRow";
import { RouterAriaLink } from "./RouterAriaLink";
import {
  planStatusLabel,
  requiredElectiveLabel,
  uniquePlanCourses,
} from "../lib/jwxt-course-rows";
import type { JwxtFilterOption, JwxtOffering } from "../lib/jwxt-offering";
import {
  isJwxtFilterSelected,
  jwxtCandidateFiltersReady,
  offeringKey,
} from "../lib/jwxt-offering";
import { findSameCourse, type PlannedItem } from "../lib/jwxt-plan";
import type { JwxtSnapshotV1 } from "../lib/jwxt-snapshot";

function FilterSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  isDisabled,
}: {
  label: string;
  value: string;
  options: JwxtFilterOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <Select
      className="min-w-36"
      variant="secondary"
      placeholder={placeholder}
      isDisabled={isDisabled}
      value={value || null}
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

function FilterCombo({
  label,
  value,
  options,
  onChange,
  placeholder,
  isDisabled,
}: {
  label: string;
  value: string;
  options: JwxtFilterOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <ComboBox
      allowsEmptyCollection
      className="min-w-56"
      variant="secondary"
      isDisabled={isDisabled}
      selectedKey={value || null}
      onSelectionChange={(next) => {
        if (typeof next === "string") onChange(next);
        else if (next == null) onChange("");
      }}
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <Input placeholder={placeholder} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          renderEmptyState={() => (
            <div className="py-4 text-center text-sm text-muted">没有匹配项</div>
          )}
        >
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}

function CoursePickTable({
  label,
  offerings,
  planItems,
  onStage,
}: {
  label: string;
  offerings: JwxtOffering[];
  planItems: PlannedItem[];
  onStage: (offering: JwxtOffering) => void;
}) {
  const [sourceCategory, setSourceCategory] = useState("");
  const sourceOptions = useMemo(() => (
    [...new Set(offerings.map((offering) => offering.categoryPath.trim()).filter(Boolean))]
      .map((path) => ({ id: path, label: path }))
  ), [offerings]);
  useEffect(() => {
    if (sourceCategory && !sourceOptions.some((option) => option.id === sourceCategory)) {
      setSourceCategory("");
    }
  }, [sourceCategory, sourceOptions]);
  const visibleOfferings = sourceCategory
    ? offerings.filter((offering) => offering.categoryPath === sourceCategory)
    : offerings;
  return (
    <div>
      {sourceOptions.length > 0 ? (
        <div className="mb-3 max-w-sm">
          <FilterSelect
            label="来源类别"
            value={sourceCategory || "__all__"}
            options={[{ id: "__all__", label: "全部来源类别" }, ...sourceOptions]}
            onChange={(value) => setSourceCategory(value === "__all__" ? "" : value)}
          />
        </div>
      ) : null}
      {offerings.length === 0 ? (
        <p className="text-sm text-muted" role="status">
          暂无数据
        </p>
      ) : visibleOfferings.length === 0 ? (
        <div className="flex items-center gap-2" role="status">
          <p className="text-sm text-muted">当前来源类别没有匹配课程。</p>
          <Button size="sm" variant="secondary" onPress={() => setSourceCategory("")}>清除筛选</Button>
        </div>
      ) : (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label} className="w-full min-w-[48rem]">
          <Table.Header>
            <Table.Column isRowHeader>课程</Table.Column>
            <Table.Column>学分</Table.Column>
            <Table.Column>建议学期</Table.Column>
            <Table.Column>本站评价</Table.Column>
            <Table.Column>操作</Table.Column>
          </Table.Header>
          <Table.Body>
            {visibleOfferings.map((offering, index) => {
                const staged = findSameCourse(planItems, offering.courseCode);
                return (
                  <Table.Row key={offering.courseCode || `${label}-${index}`} id={offering.courseCode || `${label}-${index}`}>
                    <Table.Cell>
                      <div className="font-medium">{offering.courseName}</div>
                      <div className="text-sm text-muted">
                        {offering.courseCode}
                        {offering.categoryPath ? ` · ${offering.categoryPath}` : ""}
                      </div>
                    </Table.Cell>
                    <Table.Cell>{offering.credits ?? "—"}</Table.Cell>
                    <Table.Cell>{offering.suggestedTerm || "—"}</Table.Cell>
                    <Table.Cell>
                      {offering.catalogCourseId ? (
                        <RouterAriaLink
                          className="text-accent"
                          to={relationDetailHref({
                            course_id: offering.catalogCourseId,
                            teacher_id: offering.catalogTeacherId,
                          })}
                        >
                          {offering.catalogRating != null
                            ? `${offering.catalogRating.toFixed(1)} · ${offering.catalogReviewCount ?? 0} 条`
                            : "查看课程"}
                        </RouterAriaLink>
                      ) : "未匹配"}
                    </Table.Cell>
                    <Table.Cell>
                      {staged ? (
                        <Button size="sm" variant="secondary" isDisabled>
                          已加入
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => onStage(offering)}
                        >
                          加入待选课表
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
      )}
    </div>
  );
}

function SectionTable({
  offerings,
  termId,
  planItems,
  emptyHint,
  loading,
  error,
  onRetry,
  onJoin,
}: {
  offerings: JwxtOffering[];
  termId: string;
  planItems: PlannedItem[];
  emptyHint: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onJoin: (offering: JwxtOffering) => void;
}) {
  if (loading) {
    return <p className="text-sm text-muted" role="status">开课班加载中…</p>;
  }
  if (error) {
    return (
      <Alert role="alert" status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>开课班加载失败</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
          <Button className="mt-2" size="sm" variant="secondary" onPress={onRetry}>重试</Button>
        </Alert.Content>
      </Alert>
    );
  }
  if (offerings.length === 0) {
    return (
      <p className="text-sm text-muted" role="status">
        {emptyHint}
      </p>
    );
  }
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="开课班" className="w-full min-w-[40rem]">
          <Table.Header>
            <Table.Column isRowHeader>教师</Table.Column>
            <Table.Column>校区</Table.Column>
            <Table.Column>课程安排</Table.Column>
            <Table.Column>状态</Table.Column>
            <Table.Column>本站评价</Table.Column>
            <Table.Column>操作</Table.Column>
          </Table.Header>
          <Table.Body>
            {offerings.map((offering, index) => {
              const key = offeringKey(termId, offering.courseCode, offering.section, offering.courseName);
              const existing = planItems.find((item) => item.key === key && item.status >= 1);
              const sameCourse = findSameCourse(planItems, offering.courseCode);
              const canSwap = Boolean(sameCourse && sameCourse.status >= 1 && sameCourse.section);
              return (
                <Table.Row key={key || `section-${index}`} id={key || `section-${index}`}>
                  <Table.Cell>{offering.teacherName || "—"}</Table.Cell>
                  <Table.Cell>{offering.campus || "—"}</Table.Cell>
                  <Table.Cell>
                    {[offering.weekText, offering.timeText, offering.place].filter(Boolean).join(" ") || "暂无上课时间"}
                  </Table.Cell>
                  <Table.Cell>{offering.enrollStatus || (existing ? "已加入" : "未选")}</Table.Cell>
                  <Table.Cell>
                    {offering.catalogCourseId ? (
                      <RouterAriaLink
                        className="text-accent"
                        to={relationDetailHref({
                          course_id: offering.catalogCourseId,
                          teacher_id: offering.catalogTeacherId,
                        })}
                      >
                        {offering.catalogRating != null
                          ? `${offering.catalogRating.toFixed(1)} · ${offering.catalogReviewCount ?? 0} 条`
                          : "查看课程"}
                      </RouterAriaLink>
                    ) : "未匹配"}
                  </Table.Cell>
                  <Table.Cell>
                    {existing ? (
                      <Button size="sm" variant="secondary" isDisabled>
                        已加入
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => onJoin(offering)}
                      >
                        {canSwap ? "换班" : "加入课表"}
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
  );
}

export function JwxtCourseBrowser({
  snapshot,
  planItems,
  courseOfferings,
  candidatesReady,
  candidatesLoading = false,
  candidatesError = "",
  courseOfferingsLoading = false,
  courseOfferingsError = "",
  onFilters,
  onSelectedCourseChange,
  onRetryCourseOfferings,
  onRetryCandidates,
  onStage,
  onJoin,
  onToggle,
  onRemove,
  onSave,
  savePending = false,
}: {
  snapshot: JwxtSnapshotV1;
  planItems: PlannedItem[];
  courseOfferings: JwxtOffering[];
  candidatesReady?: boolean;
  candidatesLoading?: boolean;
  candidatesError?: string;
  courseOfferingsLoading?: boolean;
  courseOfferingsError?: string;
  onFilters: (patch: Partial<Pick<JwxtSnapshotV1, "term" | "educationLevel" | "grade" | "major">>) => void;
  onSelectedCourseChange?: (courseCode: string) => void;
  onRetryCourseOfferings?: () => void;
  onRetryCandidates?: () => void;
  onStage: (offering: JwxtOffering, origin: "planned" | "public") => void;
  onJoin: (offering: JwxtOffering, origin: "planned" | "public") => void;
  onToggle: (item: PlannedItem, included: boolean) => void;
  onRemove: (item: PlannedItem) => void;
  onSave: () => void;
  savePending?: boolean;
}) {
  const termId = snapshot.term.id;
  const gradeReady = snapshot.grades.length === 0 || isJwxtFilterSelected(snapshot.grade);
  const canBrowseCandidates = candidatesReady ?? jwxtCandidateFiltersReady(snapshot);
  const courseRows = useMemo(() => uniquePlanCourses(planItems), [planItems]);
  const courseRowsKey = courseRows.map((item) => item.courseCode).join("|");
  const [selectedCode, setSelectedCode] = useState(courseRows[0]?.courseCode ?? "");
  const [dropItem, setDropItem] = useState<PlannedItem | null>(null);

  useEffect(() => {
    if (selectedCode && courseRows.some((item) => item.courseCode === selectedCode)) return;
    setSelectedCode(courseRows[0]?.courseCode ?? "");
  }, [courseRows, selectedCode]);

  useEffect(() => {
    if (selectedCode) onSelectedCourseChange?.(selectedCode);
  }, [courseRowsKey, selectedCode]); // eslint-disable-line react-hooks/exhaustive-deps -- notify when the available course set changes

  const selectedCourse = courseRows.find((item) => item.courseCode === selectedCode);
  const joinOrigin = (offering: JwxtOffering): "planned" | "public" => (
    snapshot.publicElectives.some((item) => item.courseCode === offering.courseCode)
      ? "public"
      : "planned"
  );
  const selectedHasCatalog = Boolean(
    snapshot.planned.find((item) => item.courseCode === selectedCode)?.catalogCourseId
    || snapshot.publicElectives.find((item) => item.courseCode === selectedCode)?.catalogCourseId
  );
  const sectionEmptyHint = selectedCourse && !selectedHasCatalog
    ? "本站目录尚未收录该课号，暂无开课班。"
    : "暂无数据";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Typography className="m-0 text-sm font-semibold" type="h2">
          专业选择
        </Typography>
        <div className="mt-2 flex flex-wrap gap-3">
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
          placeholder="请选择年级"
          onChange={(id) => {
            const grade = snapshot.grades.find((item) => item.id === id);
            if (grade) onFilters({ grade, major: { id: "", label: "" } });
          }}
        />
        <FilterCombo
          label="专业"
          value={snapshot.major.id}
          options={snapshot.majors}
          placeholder="搜索或选择专业"
          isDisabled={!gradeReady}
          onChange={(id) => {
            const major = snapshot.majors.find((item) => item.id === id);
            onFilters({ major: major ?? { id: "", label: "" } });
          }}
        />
        </div>
      </div>
      {!canBrowseCandidates ? (
        <p className="text-sm text-muted" role="status">
          请先选择年级和专业，再浏览培养方案课和公共选修。已加入的课可先查看。
        </p>
      ) : candidatesLoading ? (
        <p className="text-sm text-muted" role="status">培养方案和公共选修目录加载中…</p>
      ) : candidatesError ? (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>目录加载失败</Alert.Title>
            <Alert.Description>{candidatesError}</Alert.Description>
            <Button className="mt-2" size="sm" variant="secondary" onPress={() => onRetryCandidates?.()}>重试</Button>
          </Alert.Content>
        </Alert>
      ) : (
        <Card>
          <Card.Header>
            <Card.Title>待选的课</Card.Title>
          </Card.Header>
          <Card.Content>
            <Tabs defaultSelectedKey="planned">
              <Tabs.ListContainer>
                <Tabs.List aria-label="教务课程分类">
                  <Tabs.Tab id="planned">
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
              <Tabs.Panel className="pt-3" id="planned">
                <CoursePickTable
                  label="计划内课程"
                  offerings={snapshot.planned}
                  planItems={planItems}
                  onStage={(offering) => onStage(offering, "planned")}
                />
              </Tabs.Panel>
              <Tabs.Panel className="pt-3" id="public">
                <CoursePickTable
                  label="公共选修"
                  offerings={snapshot.publicElectives}
                  planItems={planItems}
                  onStage={(offering) => onStage(offering, "public")}
                />
              </Tabs.Panel>
            </Tabs>
          </Card.Content>
        </Card>
      )}
      <div aria-label="课程与开课班" className="flex flex-col gap-4 lg:flex-row" role="region">
        <Card className="min-w-0 flex-1">
          <Card.Header className="flex flex-wrap items-center justify-between gap-2">
            <Card.Title>待选课表</Card.Title>
            <Button
              size="sm"
              variant="primary"
              isPending={savePending}
              isDisabled={savePending}
              onPress={onSave}
            >
              {savePending ? "保存中…" : "保存课表"}
            </Button>
          </Card.Header>
          <Card.Content>
            {courseRows.length === 0 ? (
              <p className="text-sm text-muted" role="status">
                暂无数据
              </p>
            ) : (
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="待选课表" className="w-full min-w-[36rem]">
                    <Table.Header>
                      <Table.Column isRowHeader>课程名称</Table.Column>
                      <Table.Column>学分</Table.Column>
                      <Table.Column>必/选</Table.Column>
                      <Table.Column>教师</Table.Column>
                      <Table.Column>状态</Table.Column>
                      <Table.Column>操作</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {courseRows.map((item) => (
                        <Table.Row key={item.courseCode} id={item.courseCode}>
                          <Table.Cell>
                            <Button
                              size="sm"
                              variant={item.courseCode === selectedCode ? "secondary" : "ghost"}
                              onPress={() => setSelectedCode(item.courseCode)}
                            >
                              {item.courseName}
                            </Button>
                            <div className="text-sm text-muted">
                              {item.courseCode}
                            </div>
                          </Table.Cell>
                          <Table.Cell>{item.credits ?? "—"}</Table.Cell>
                          <Table.Cell>{requiredElectiveLabel(item.categoryPath, item.origin)}</Table.Cell>
                          <Table.Cell>{item.teacherName || "—"}</Table.Cell>
                          <Table.Cell>{planStatusLabel(item)}</Table.Cell>
                          <Table.Cell>
                            {item.origin === "enrolled" ? (
                              <Button
                                size="sm"
                                variant={item.included ? "ghost" : "secondary"}
                                onPress={() => onToggle(item, !item.included)}
                              >
                                {item.included ? "排除" : "恢复"}
                              </Button>
                            ) : item.status === 2 ? (
                              <Button
                                size="sm"
                                variant="danger"
                                onPress={() => setDropItem(item)}
                              >
                                退课
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="danger"
                                onPress={() => onRemove(item)}
                              >
                                清除
                              </Button>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            )}
          </Card.Content>
        </Card>
        <Card className="min-w-0 flex-1">
          <Card.Header>
            <Card.Title>
              {selectedCourse ? `${selectedCourse.courseName} ${selectedCourse.courseCode}` : "开课班"}
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <SectionTable
              offerings={courseOfferings}
              termId={termId}
              planItems={planItems}
              emptyHint={sectionEmptyHint}
              loading={courseOfferingsLoading}
              error={courseOfferingsError}
              onRetry={() => onRetryCourseOfferings?.()}
              onJoin={(offering) => onJoin(offering, joinOrigin(offering))}
            />
          </Card.Content>
        </Card>
      </div>
      <Modal.Backdrop isOpen={Boolean(dropItem)} onOpenChange={(open) => { if (!open) setDropItem(null); }}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>退课</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>确定把{dropItem?.courseName}从已选课表中移除？未保存的备选请用清除。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  if (dropItem) onRemove(dropItem);
                  setDropItem(null);
                }}
              >
                退课
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
