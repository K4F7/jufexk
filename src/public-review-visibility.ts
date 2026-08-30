/**
 * 任课评价公开可见性：全站公开投影共用的资格 SQL。
 * 调用方查询仍需限定已批准。片段本身约束未删除，并绑定有效任课关系及开课班；
 * 公开流再排除已屏蔽，游客视图额外排除仅限登录用户查看的评价。
 */

/** 未删除且任课/开班绑定有效。公开流另加 blocked_at IS NULL。 */
export const reviewNotDeletedBindingSql = `
       AND r.deleted_at IS NULL
       AND EXISTS(
         SELECT 1 FROM course_teachers public_relation
         WHERE public_relation.course_id=r.course_id
           AND public_relation.teacher_id=r.teacher_id
       )
       AND (
         r.offering_id IS NULL OR EXISTS(
           SELECT 1
           FROM offerings public_offering
           JOIN offering_teachers public_offering_teacher
             ON public_offering_teacher.offering_id=public_offering.id
            AND public_offering_teacher.teacher_id=r.teacher_id
           WHERE public_offering.id=r.offering_id
             AND public_offering.course_id=r.course_id
         )
       )`;

/** 与公开文字流一致的任课评价可见性绑定：未屏蔽、未删除，且关系/开班绑定有效。 */
export const publicReviewBindingSql = `
       AND r.blocked_at IS NULL${reviewNotDeletedBindingSql}`;

/** 游客视图再排除「仅限登录用户查看」的评价。 */
export const guestReviewBindingSql = `
       ${publicReviewBindingSql}
       AND r.login_only=0`;

/** 公开历史评价：未屏蔽、未删除。 */
export const historicalPublicVisibleSql = (alias = "phr") =>
  ` AND ${alias}.deleted_at IS NULL AND ${alias}.blocked_at IS NULL`;

/** 管理员可见已屏蔽历史评价，仍排除软删除。 */
export const historicalNotDeletedSql = (alias = "phr") =>
  ` AND ${alias}.deleted_at IS NULL`;
