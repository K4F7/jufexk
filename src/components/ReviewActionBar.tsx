/**
 * Course review footer: 认可 / 质疑 / 评论 / 分享, and the
 * HeroUI comments Surface. 认可 uses the live endorsement API. 回复默认收起，
 * 点评论按钮展开并拉取 /api/reviews/:id/comments；DEV atlas / preview
 * 保持本地种子回复。回复他人的评论会展开回复区并聚焦输入框。
 */
import {
  ArrowShapeTurnUpRight,
  ArrowUpFromSquare,
  Comment,
  CommentFill,
  CopyCheck,
} from "@gravity-ui/icons";
import {
  Alert,
  Button,
  Chip,
  InputGroup,
  Label,
  Separator,
  Spinner,
  Surface,
  TextField,
  Toolbar,
} from "@heroui/react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useReviewComments } from "../hooks/useReviewComments";
import { resolveCommentDeleteVisible } from "../lib/review-admin-chrome";
import { formatPublicCode, formatPublicHandle } from "../public-handle";
import { formatRelativeTime, formatReviewDate } from "../lib/review-date";
import { reviewSharePath } from "../lib/review-dimensions";
import type { PublicReview, ReviewComment } from "../lib/types";
import { AnonymousAvatar } from "./AnonymousAvatar";
import { DetailLoadingStatus } from "./DetailFeedback";
import { RouterAriaLink } from "./RouterAriaLink";
import {
  ReviewActionCount,
  ReviewChallengeButton,
  ReviewRecognitionAlerts,
  ReviewRecognitionButton,
  useCommentRecognition,
  useReviewRecognition,
} from "./ReviewRecognitionControl";

function commentButtonLabel(open: boolean, count: number) {
  const countLabel =
    count > 0 ? `当前 ${count} 条回复` : "还没有回复";
  return open ? `收起评论，${countLabel}` : `评论，${countLabel}`;
}

type ReplyTarget = { id: string; handle: string; snippet: string };

function commentSnippet(body: string, max = 20): string {
  const text = body.trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function ReviewActionBar({
  review,
  recognition,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
  endorsable,
  seedComments,
  viewerPublicCode,
  previewComposer,
  showAdminControls = false,
}: {
  review: PublicReview;
  recognition: ReturnType<typeof useReviewRecognition>;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
  endorsable: boolean;
  seedComments: ReviewComment[];
  viewerPublicCode: number | null;
  /** DEV atlas / preview: show the composer without a live write path. */
  previewComposer: boolean;
  /** dock 开关打开后才渲染 preview `viewerOwned` 的回复删除。 */
  showAdminControls?: boolean;
}) {
  const comments = useReviewComments({
    review,
    seedComments,
    previewComposer,
    viewerPublicCode,
    onUnauthenticated,
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commentsId = useId();
  const canCompose = authenticated || previewComposer;
  const submitLabel = replyTarget ? "回复" : "评论";

  useEffect(() => {
    setOpen(false);
    setDraft("");
    setReplyTarget(null);
  }, [review.id]);

  useEffect(() => {
    if (open) comments.ensureLoaded();
  }, [open, comments.ensureLoaded]);

  const focusComposer = () => {
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const toggleComments = () => {
    setOpen((current) => {
      const next = !current;
      if (next) focusComposer();
      return next;
    });
  };

  const beginReply = (comment: ReviewComment) => {
    setReplyTarget({
      id: comment.id,
      handle: formatPublicHandle(comment.authorPublicCode),
      snippet: commentSnippet(comment.body),
    });
    setOpen(true);
    focusComposer();
  };

  const submitComment = () => {
    void comments
      .submit(draft, replyTarget?.id ?? null)
      .then((ok) => {
        if (!ok) return;
        setDraft("");
        setReplyTarget(null);
      });
  };

  const share = async () => {
    const url = `${window.location.origin}${reviewSharePath(review)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Toolbar aria-label="评价动作">
          {endorsable ? (
            <>
              <ReviewRecognitionButton
                appearance="icon"
                state={recognition.state}
                ready={recognition.ready}
                busy={recognition.challenge.pending !== null}
                onPress={() => {
                  void recognition.press();
                }}
              />
              <ReviewChallengeButton
                state={recognition.challenge}
                ready={recognition.ready}
                busy={recognition.state.pending !== null}
                onPress={() => {
                  void recognition.pressChallenge();
                }}
              />
            </>
          ) : null}
          {comments.live || previewComposer ? (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              aria-controls={commentsId}
              aria-label={commentButtonLabel(open, comments.count)}
              onPress={toggleComments}
            >
              {open ? <CommentFill aria-hidden /> : <Comment aria-hidden />}
              <ReviewActionCount count={comments.count} />
            </Button>
          ) : null}
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={copied ? "已复制链接" : "分享"}
            onPress={() => {
              void share();
            }}
          >
            {copied ? <CopyCheck aria-hidden /> : <ArrowUpFromSquare aria-hidden />}
          </Button>
        </Toolbar>
      </div>
      {endorsable ? (
        <ReviewRecognitionAlerts error={recognition.error} />
      ) : null}
      {open ? (
        <ReviewCommentsPanel
          id={commentsId}
          reviewId={review.id}
          comments={comments.comments}
          loading={comments.loading}
          error={comments.error}
          draft={draft}
          submitLabel={submitLabel}
          submitting={comments.submitting}
          replyTarget={replyTarget}
          canCompose={canCompose}
          loginTarget={recognition.loginTarget}
          viewerPublicCode={viewerPublicCode}
          showAdminControls={showAdminControls}
          previewComposer={previewComposer}
          ready={ready}
          authenticated={authenticated}
          loginPath={loginPath}
          onUnauthenticated={onUnauthenticated}
          textareaRef={textareaRef}
          onDraftChange={setDraft}
          onReply={beginReply}
          onCancelReply={() => setReplyTarget(null)}
          onDelete={(id) => {
            void comments.remove(id);
          }}
          onSubmit={submitComment}
        />
      ) : null}
    </div>
  );
}

function CommentRowActions({
  reviewId,
  comment,
  handle,
  canDelete,
  previewComposer,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
  onReply,
  onDelete,
}: {
  reviewId: string | number;
  comment: ReviewComment;
  handle: string;
  canDelete: boolean;
  previewComposer: boolean;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
  onReply: (comment: ReviewComment) => void;
  onDelete: (id: string) => void;
}) {
  const recognition = useCommentRecognition({
    reviewId,
    comment,
    preview: previewComposer,
    ready,
    authenticated,
    loginPath,
    onUnauthenticated,
  });
  return (
    <div>
      <div className="flex items-center">
        <ReviewRecognitionButton
          appearance="icon"
          noun="回复"
          state={recognition.state}
          ready={recognition.ready}
          onPress={() => {
            void recognition.press();
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="text-accent"
          aria-label={`回复 ${handle}`}
          onPress={() => onReply(comment)}
        >
          <ArrowShapeTurnUpRight aria-hidden />
          回复
        </Button>
        {canDelete ? (
          <Button
            size="sm"
            variant="danger"
            aria-label={`删除 ${handle} 的回复`}
            onPress={() => onDelete(comment.id)}
          >
            删除
          </Button>
        ) : null}
      </div>
      <ReviewRecognitionAlerts error={recognition.error} noun="回复" />
    </div>
  );
}

function ReviewCommentsPanel({
  id,
  reviewId,
  comments,
  loading,
  error,
  draft,
  submitLabel,
  submitting,
  replyTarget,
  canCompose,
  loginTarget,
  viewerPublicCode,
  showAdminControls,
  previewComposer,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
  textareaRef,
  onDraftChange,
  onReply,
  onCancelReply,
  onDelete,
  onSubmit,
}: {
  id: string;
  reviewId: string | number;
  comments: ReviewComment[];
  loading: boolean;
  error: string | null;
  draft: string;
  submitLabel: string;
  submitting: boolean;
  replyTarget: ReplyTarget | null;
  canCompose: boolean;
  loginTarget: string;
  viewerPublicCode: number | null;
  showAdminControls: boolean;
  previewComposer: boolean;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string) => void;
  onReply: (comment: ReviewComment) => void;
  onCancelReply: () => void;
  onDelete: (id: string) => void;
  onSubmit: () => void;
}) {
  const byId = new Map(comments.map((item) => [item.id, item]));
  return (
    <Surface
      id={id}
      className="mt-3 flex flex-col gap-3 rounded-2xl p-4"
      variant="secondary"
    >
      {loading && comments.length === 0 ? (
        <DetailLoadingStatus label="回复加载中…" />
      ) : null}
      {comments.map((item, index) => {
        const handle = formatPublicHandle(item.authorPublicCode);
        const canDelete = resolveCommentDeleteVisible({
          showAdminControls,
          viewerPublicCode,
          authorPublicCode: item.authorPublicCode,
          viewerOwned: item.viewerOwned,
        });
        const parent = item.parentId ? byId.get(item.parentId) : undefined;
        return (
          <div key={item.id}>
            {index > 0 ? <Separator className="mb-3" variant="secondary" /> : null}
            <div className="flex items-start gap-2">
              <AnonymousAvatar
                avatarKey={item.authorAvatarKey ?? undefined}
                seed={item.authorPublicCode}
                size="sm"
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="mb-0 flex flex-wrap items-baseline gap-x-2 text-[calc(12/15*1rem)]">
                  <RouterAriaLink
                    className="font-medium text-accent no-underline"
                    to={`/u/${formatPublicCode(item.authorPublicCode)}`}
                  >
                    {handle}
                  </RouterAriaLink>
                  <time
                    className="text-muted"
                    dateTime={formatReviewDate(item.createdAt)}
                  >
                    {formatRelativeTime(item.createdAt)}
                  </time>
                </p>
                <p className="mb-0 mt-0.5 break-words text-sm">
                  {parent ? (
                    <RouterAriaLink
                      className="me-1 font-medium text-accent no-underline"
                      to={`/u/${formatPublicCode(parent.authorPublicCode)}`}
                    >
                      @{formatPublicHandle(parent.authorPublicCode)}
                    </RouterAriaLink>
                  ) : null}
                  {item.body}
                </p>
                <CommentRowActions
                  reviewId={reviewId}
                  comment={item}
                  handle={handle}
                  canDelete={canDelete}
                  previewComposer={previewComposer}
                  ready={ready}
                  authenticated={authenticated}
                  loginPath={loginPath}
                  onUnauthenticated={onUnauthenticated}
                  onReply={onReply}
                  onDelete={onDelete}
                />
              </div>
            </div>
          </div>
        );
      })}
      {error ? (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>评论区出错</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {canCompose ? (
        <>
          {comments.length > 0 ? <Separator variant="secondary" /> : null}
          <TextField
            fullWidth
            name="review-comment"
            value={draft}
            onChange={onDraftChange}
          >
            <Label className="sr-only">
              {replyTarget ? `回复 @${replyTarget.handle}` : "你的评论"}
            </Label>
            <InputGroup
              variant="secondary"
              fullWidth
              className="flex flex-col gap-2 py-2"
            >
              {replyTarget ? (
                <InputGroup.Prefix className="min-w-0 px-3 py-0">
                  <Chip color="accent" size="sm" variant="soft">
                    <Chip.Label>
                      @{replyTarget.handle}
                      {replyTarget.snippet
                        ? ` · ${replyTarget.snippet}`
                        : ""}
                    </Chip.Label>
                  </Chip>
                </InputGroup.Prefix>
              ) : null}
              <InputGroup.TextArea
                ref={textareaRef}
                className="w-full resize-none px-3.5 py-0"
                rows={2}
                placeholder="你的评论"
                onKeyDown={(event) => {
                  if (
                    replyTarget &&
                    event.key === "Backspace" &&
                    draft.length === 0
                  ) {
                    event.preventDefault();
                    onCancelReply();
                  }
                }}
              />
            </InputGroup>
          </TextField>
          <div className="flex justify-end">
            <Button
              size="sm"
              isDisabled={!draft.trim()}
              isPending={submitting}
              onPress={onSubmit}
            >
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {submitLabel}
                </>
              )}
            </Button>
          </div>
        </>
      ) : (
        <p className="mb-0 text-sm text-muted">
          立即
          <RouterAriaLink to={loginTarget}>登录</RouterAriaLink>
          ，说说你的看法
        </p>
      )}
    </Surface>
  );
}
