/**
 * 评价回复区数据层：公开文字流条目走 /api/reviews/:id/comments；
 * DEV atlas / preview 保持本地种子回复，不打接口。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { parsePublicReviewTarget } from "../lib/public-review-id";
import type { PublicReview, ReviewComment } from "../lib/types";

type ApiComment = {
  id: string | number;
  authorPublicCode?: number | null;
  authorAvatarKey?: number | null;
  body: string;
  createdAt: string;
  parentId?: string | number | null;
  endorsementCount?: number;
  viewerEndorsed?: boolean;
};

function normalizeComment(row: ApiComment): ReviewComment {
  return {
    id: String(row.id),
    authorPublicCode: row.authorPublicCode ?? 0,
    authorAvatarKey: row.authorAvatarKey ?? null,
    body: row.body,
    createdAt: row.createdAt,
    parentId: row.parentId != null ? String(row.parentId) : null,
    endorsementCount: Number(row.endorsementCount) || 0,
    viewerEndorsed: row.viewerEndorsed === true,
  };
}

/** 公开文字流条目（任课评价 / 历史评价 / 已批准资料行）可走回复后端。 */
export function isCommentableReview(review: PublicReview) {
  return parsePublicReviewTarget(String(review.id)) != null;
}

function localCommentId(reviewId: string | number, index: number) {
  return `local-${String(reviewId)}-${index}`;
}

function nowTimestamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function useReviewComments({
  review,
  seedComments,
  previewComposer,
  viewerPublicCode,
  onUnauthenticated,
}: {
  review: PublicReview;
  seedComments: ReviewComment[];
  /** DEV atlas / preview：本地回复，不打接口。 */
  previewComposer: boolean;
  viewerPublicCode: number | null;
  onUnauthenticated: () => void;
}) {
  const live = !previewComposer && isCommentableReview(review);
  const [comments, setComments] = useState<ReviewComment[]>(seedComments);
  const [loaded, setLoaded] = useState(!live);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  useEffect(() => {
    setComments(seedComments);
    setLoaded(!live);
    setLoading(false);
    setSubmitting(false);
    setError(null);
    inflight.current = false;
  }, [review.id]); // eslint-disable-line react-hooks/exhaustive-deps -- seed is keyed by review.id

  const ensureLoaded = useCallback(() => {
    if (!live || loaded || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    setError(null);
    api<{ items?: ApiComment[] }>(`/api/reviews/${review.id}/comments`)
      .then((data) => {
        setComments((data?.items ?? []).map(normalizeComment));
        setLoaded(true);
      })
      .catch(() => {
        setError("回复加载失败，请稍后重试。");
      })
      .finally(() => {
        inflight.current = false;
        setLoading(false);
      });
  }, [live, loaded, review.id]);

  const submit = useCallback(
    async (body: string, parentId: string | null) => {
      const trimmed = body.trim();
      if (!trimmed || submitting) return false;
      if (!live) {
        setComments((current) => [
          ...current,
          {
            id: localCommentId(review.id, current.length + 1),
            authorPublicCode: viewerPublicCode ?? 1,
            body: trimmed,
            createdAt: nowTimestamp(),
            parentId,
            endorsementCount: 0,
            viewerOwned: true,
          },
        ]);
        return true;
      }
      setSubmitting(true);
      setError(null);
      try {
        const data = await api<{ comment: ApiComment }>(
          `/api/reviews/${review.id}/comments`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({
              body: trimmed,
              parentCommentId: parentId,
            }),
          },
        );
        const comment = normalizeComment(data.comment);
        setComments((current) => [...current, comment]);
        setLoaded(true);
        return true;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthenticated();
        } else {
          setError(
            cause instanceof ApiError && cause.message
              ? cause.message
              : "回复失败，请稍后重试。",
          );
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [live, review.id, submitting, viewerPublicCode, onUnauthenticated],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!live) {
        setComments((current) => current.filter((item) => item.id !== id));
        return;
      }
      try {
        await api(`/api/reviews/${review.id}/comments/${id}`, {
          method: "DELETE",
        });
        setComments((current) => current.filter((item) => item.id !== id));
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthenticated();
        } else {
          setError("删除失败，请稍后重试。");
        }
      }
    },
    [live, review.id, onUnauthenticated],
  );

  // 未展开拉取前用评价下发的 comment_count；拉取后（或本地模式）以实际列表为准。
  const count = live && !loaded ? (review.comment_count ?? 0) : comments.length;

  return {
    comments,
    count,
    live,
    loading,
    submitting,
    error,
    ensureLoaded,
    submit,
    remove,
  };
}
