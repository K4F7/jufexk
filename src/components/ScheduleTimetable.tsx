import { Chip, Table } from "@heroui/react";
import {
  buildOccupied,
  cellHasConflict,
  JUFE_PERIODS,
  WEEKDAYS,
  type StagedCourse,
} from "../lib/schedule-plan";
import { relationDetailHref } from "./CourseRelationRow";
import { RouterAriaLink } from "./RouterAriaLink";

/* 窄屏单元格:八等分下的紧凑内边距与居中;sm+ 恢复官方默认。 */
const COMPACT_CELL = "px-1 py-1 text-center sm:px-4 sm:text-start";
const COMPACT_HEAD_CELL = `${COMPACT_CELL} sm:py-2.5`;
const COMPACT_BODY_CELL = `${COMPACT_CELL} sm:py-3`;
const COMPACT_LINK =
  "text-[calc(11/15*1rem)] leading-tight [overflow-wrap:anywhere] sm:text-[calc(13/15*1rem)] sm:leading-normal sm:[overflow-wrap:normal]";

export function ScheduleTimetable({ courses }: { courses: StagedCourse[] }) {
  const occupied = buildOccupied(courses);
  /* min-w-0:作为 grid 项允许收缩到轨道宽。
     窄屏 table-fixed 全宽八等分,整周一屏看完不横滑;
     sm+ 恢复 min-w 宽表,横向滚动由 ScrollContainer 承担。 */
  return (
    <Table className="min-w-0">
      <Table.ScrollContainer>
        <Table.Content
          aria-label="周课表"
          className="w-full min-w-0 table-fixed sm:min-w-[40rem] sm:table-auto"
        >
          <Table.Header>
            <Table.Column isRowHeader className={COMPACT_HEAD_CELL}>
              节次
            </Table.Column>
            {WEEKDAYS.map((day) => (
              <Table.Column key={day.day} className={COMPACT_HEAD_CELL}>
                {day.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {JUFE_PERIODS.map((period, row) => (
              <Table.Row key={period.period} id={`period-${period.period}`}>
                <Table.Cell className={COMPACT_BODY_CELL}>
                  <div>
                    <span className="sm:hidden">{period.period}</span>
                    <span className="hidden sm:inline">第{period.period}节</span>
                  </div>
                  <div className="hidden text-[calc(11/15*1rem)] text-muted sm:block">
                    {period.start}–{period.end}
                  </div>
                </Table.Cell>
                {WEEKDAYS.map((day, col) => {
                  const cell = occupied[row][col];
                  const conflict = cellHasConflict(cell);
                  return (
                    <Table.Cell
                      key={day.day}
                      className={
                        conflict
                          ? `${COMPACT_BODY_CELL} bg-danger/10`
                          : COMPACT_BODY_CELL
                      }
                      data-conflict={conflict ? "true" : undefined}
                    >
                      {cell.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <ul className="m-0 list-none space-y-1 p-0">
                          {cell.map((item) => {
                              const className = conflict
                                ? `${COMPACT_LINK} text-danger`
                                : `${COMPACT_LINK} text-accent sm:text-foreground`;
                              const label = item.courseName;
                              return (
                                <li key={`${item.courseKey}-${period.period}-${day.day}`}>
                                  {item.courseId > 0 ? (
                                    <RouterAriaLink
                                      className={className}
                                      to={relationDetailHref({
                                        course_id: item.courseId,
                                        teacher_id: item.teacherId,
                                      })}
                                    >
                                      {label}
                                    </RouterAriaLink>
                                  ) : (
                                    <span className={className}>{label}</span>
                                  )}
                                </li>
                              );
                            })}
                        </ul>
                      )}
                      {conflict ? (
                        <Chip
                          aria-label="冲突"
                          className="mt-1 h-4 w-4 min-w-0 justify-center px-0 sm:h-auto sm:w-auto sm:px-2"
                          color="danger"
                          size="sm"
                          variant="soft"
                        >
                          <Chip.Label aria-hidden className="px-0">
                            <span className="sm:hidden">!</span>
                            <span className="hidden sm:inline">冲突</span>
                          </Chip.Label>
                        </Chip>
                      ) : null}
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
