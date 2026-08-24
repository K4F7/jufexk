import { Table } from "@heroui/react";
import {
  buildOccupied,
  cellHasConflict,
  JUFE_PERIODS,
  WEEKDAYS,
  type StagedCourse,
} from "../lib/schedule-plan";
import { relationDetailHref } from "./CourseRelationRow";
import { RouterAriaLink } from "./RouterAriaLink";

export function ScheduleTimetable({ courses }: { courses: StagedCourse[] }) {
  const occupied = buildOccupied(courses);
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="周课表" className="min-w-[40rem]">
          <Table.Header>
            <Table.Column isRowHeader>节次</Table.Column>
            {WEEKDAYS.map((day) => (
              <Table.Column key={day.day}>{day.label}</Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {JUFE_PERIODS.map((period, row) => (
              <Table.Row key={period.period} id={`period-${period.period}`}>
                <Table.Cell>
                  <div>第{period.period}节</div>
                  <div className="text-[calc(11/15*1rem)] text-muted">
                    {period.start}–{period.end}
                  </div>
                </Table.Cell>
                {WEEKDAYS.map((day, col) => {
                  const cell = occupied[row][col];
                  const conflict = cellHasConflict(cell);
                  return (
                    <Table.Cell
                      key={day.day}
                      className={conflict ? "bg-danger/10" : undefined}
                      data-conflict={conflict ? "true" : undefined}
                    >
                      {cell.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <ul className="m-0 list-none space-y-1 p-0">
                          {cell.map((item) => (
                            <li key={`${item.courseKey}-${period.period}-${day.day}`}>
                              <RouterAriaLink
                                className={
                                  conflict ? "text-danger" : "text-accent"
                                }
                                to={relationDetailHref({
                                  course_id: item.courseId,
                                  teacher_id: item.teacherId,
                                })}
                              >
                                {item.courseName}
                              </RouterAriaLink>
                            </li>
                          ))}
                        </ul>
                      )}
                      {conflict ? (
                        <div className="mt-1 text-[calc(11/15*1rem)] text-danger">
                          冲突
                        </div>
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
