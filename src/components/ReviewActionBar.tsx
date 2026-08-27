/**
 * Course review footer: date + 认可 / 评论 / 分享, and the
 * HeroUI comments Surface. 认可 uses the live endorsement API. 回复默认收起，
 * 点评论按钮展开并拉取 /api/reviews/:id/comments（当前评价）；DEV atlas /
 * preview 与历史评价保持本地种子回复。回复他人的评论会展开回复区并聚焦输入框；
 * 顶层回复通知评价作者、回复他人的回复通知被回复者（review_comment_replied）。
 */
import {
  ArrowUpFromSquare,
  Comment,
  CommentFill,
  CopyCheck,
} from "@gravity-ui/icons";
import {
  Alert,
  Button,
  Separator,
  Spinner,
  Surface,
  TextArea,
  Toolbar,
} from "@heroui/react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useReviewComments } from "../hooks/useReviewComments";
import { formatPublicCode, formatPublicHandle } from "../public-handle";
import { formatRelativeTime, formatReviewDate } from "../lib/review-date";
import { reviewSharePath } from "../lib/review-dimensions";
import type { PublicReview, ReviewComment } from "../lib/types";
import { AnonymousAvatar } from "./AnonymousAvatar";
import { DetailLoadingStatus } from "./DetailFeedback";
import { RouterAriaLink } from "./RouterAriaLink";
import {
  ReviewRecognitionAlerts,
  ReviewRecognitionButton,
  useReviewRecognition,
} from "./ReviewRecognitionControl";

function commentButtonLabel(open: boolean, count: number) {
  const countLabel =
    count > 0 ? `当前 ${count} 条回复` : "还没有回复";
  return open ? `收起评论，${countLabel}` : `评论，${countLabel}`;
}

type ReplyTarget = { id: string; handle: string };

export function ReviewActionBar({
  review,
  date,
  ready,
  authenticated,
  loginPath,
  onUnauthenticated,
  endorsable,
  seedComments,
  viewerPublicCode,
  previewComposer,
}: {
  review: PublicReview;
  date: string;
  ready: boolean;
  authenticated: boolean;
  loginPath: string;
  onUnauthenticated: () => void;
  endorsable: boolean;
  seedComments: ReviewComment[];
  viewerPublicCode: number | null;
  /** DEV atlas / preview: show the composer without a live write path. */
  previewComposer: boolean;
}) {
  const recognition = useReviewRecognition({
    review,
    ready,
    authenticated,
    loginPath,
    onUnauthenticated,
  });
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
        {date ? (
          <time className="text-[calc(12/15*1rem)] text-muted" dateTime={date}>
            {date}
          </time>
        ) : null}
        <Toolbar aria-label="评价动作">
          {endorsable ? (
            <ReviewRecognitionButton
              appearance="icon"
              state={recognition.state}
              ready={recognition.ready}
              onPress={() => {
                void recognition.press();
              }}
            />
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
              {comments.count > 0 ? (
                <span className="tabular">{comments.count}</span>
              ) : null}
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
        <ReviewRecognitionAlerts
          error={recognition.error}
          loginPrompted={recognition.loginPrompted}
          loginTarget={recognition.loginTarget}
        />
      ) : null}
      {open ? (
        <ReviewCommentsPanel
          id={commentsId}
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

function ReviewCommentsPanel({
  id,
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
  textareaRef,
  onDraftChange,
  onReply,
  onCancelReply,
  onDelete,
  onSubmit,
}: {
  id: string;
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
        const owned =
          item.viewerOwned ||
          (viewerPublicCode != null &&
            item.authorPublicCode === viewerPublicCode);
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
                    className="font-medium text-foreground no-underline"
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
                    <span className="text-muted">
                      回复 {formatPublicHandle(parent.authorPublicCode)}：
                    </span>
                  ) : null}
                  {item.body}
                </p>
                <div className="flex items-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`回复 ${handle}`}
                    onPress={() => onReply(item)}
                  >
                    回复
                  </Button>
                  {owned ? (
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`删除 ${handle} 的回复`}
                      onPress={() => onDelete(item.id)}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
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
          {replyTarget ? (
            <p className="mb-0 flex items-center justify-between gap-2 text-[calc(12/15*1rem)] text-muted">
              <span>回复 {replyTarget.handle}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="取消回复"
                onPress={onCancelReply}
              >
                取消
              </Button>
            </p>
          ) : null}
          <TextArea
            ref={textareaRef}
            variant="secondary"
            fullWidth
            rows={2}
            aria-label={replyTarget ? `回复 ${replyTarget.handle}` : "你的评论"}
            placeholder={replyTarget ? `回复 ${replyTarget.handle}` : "你的评论"}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
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
