/**
 * 个人主页 /profile（#459 / #493）：展示当前登录普通用户的公开编号、
 * 官方头像、自己的点评与关注的任课关系。页面不出现邮箱、学号或 users.id。
 */
import {
  Alert,
  Avatar,
  Button,
  Card,
  Chip,
  Popover,
  Separator,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type Key,
} from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  AnonymousAvatar,
  HEROUI_AVATAR_PLACEHOLDERS,
} from "../components/AnonymousAvatar";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { formatReviewDate } from "../lib/review-date";
import type { UserProfile, UserProfileReview } from "../lib/types";
import { formatPublicHandle } from "../public-handle";

function relationHref(courseId: number, teacherId: number) {
  return `/courses/${courseId}?teacher=${teacherId}`;
}

function firstSelectedKey(keys: Iterable<Key>): string | undefined {
  const [key] = keys;
  return key == null ? undefined : String(key);
}

function ReviewStatusChip({ status }: { status?: string }) {
  if (!status || status === "approved") return null;
  if (status === "pending")
    return (
      <Chip color="warning" size="sm" variant="soft">
        待审核
      </Chip>
    );
  if (status === "rejected")
    return (
      <Chip color="danger" size="sm" variant="soft">
        已驳回
      </Chip>
    );
  return (
    <Chip size="sm" variant="soft">
      {status}
    </Chip>
  );
}

function ProfileReviewItem({ review }: { review: UserProfileReview }) {
  const date = formatReviewDate(review.created_at);
  const excerpt = (review.headline || review.comment || "").trim();
  return (
    <article>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="m-0 min-w-0 text-sm leading-6">
          <RouterAriaLink
            to={relationHref(review.course_id, review.teacher_id)}
            className="text-accent"
          >
            {review.course_name}
            {review.teacher_name ? `（${review.teacher_name}）` : ""}
          </RouterAriaLink>{" "}
          <ReviewStatusChip status={review.status} />
        </p>
        {date ? (
          <time className="shrink-0 text-xs text-muted" dateTime={date}>
            {date}
          </time>
        ) : null}
      </header>
      {review.term ? (
        <p className="m-0 mt-0.5 text-xs text-muted">{review.term}</p>
      ) : null}
      {excerpt ? (
        <p className="m-0 mt-1 line-clamp-2 text-sm">{excerpt}</p>
      ) : null}
    </article>
  );
}

export function ProfilePage() {
  const { viewer, ready } = useViewer();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const lastAvatarAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ready || !viewer.authenticated) return;
    let cancelled = false;
    setLoading(true);
    api<UserProfile>("/api/user/profile")
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setAvailable(true);
      })
      .catch(() => {
        if (cancelled) return;
        setProfile(null);
        setAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, viewer.authenticated]);

  if (!ready) {
    return (
      <section aria-label="个人主页" className="py-8">
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在读取登录状态…
        </p>
      </section>
    );
  }

  if (!viewer.authenticated) {
    const from = encodeURIComponent("/profile");
    return <Navigate to={`${viewer.loginPath}?from=${from}`} replace />;
  }

  const reviews = profile?.reviews ?? [];
  const follows = profile?.follows ?? [];
  const reviewCount = profile?.review_count ?? reviews.length;
  const followCount = profile?.follow_count ?? follows.length;
  const handle =
    profile?.handle ||
    (profile?.public_code != null
      ? formatPublicHandle(profile.public_code)
      : null);
  const avatarKey = profile?.avatar_key ?? 0;
  const statValue = available && !loading;

  const changeAvatar = async (nextKey: number) => {
    if (savingAvatar || nextKey === avatarKey) {
      setAvatarPickerOpen(false);
      return;
    }
    lastAvatarAttemptRef.current = nextKey;
    setSavingAvatar(true);
    setAvatarError("");
    try {
      const updated = await api<{
        avatar_key: number;
        public_code?: number;
        handle?: string;
      }>("/api/user/profile/avatar", {
        method: "PATCH",
        body: JSON.stringify({ avatar_key: nextKey }),
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              avatar_key: updated.avatar_key,
              public_code: updated.public_code ?? current.public_code,
              handle: updated.handle ?? current.handle,
            }
          : current,
      );
      setAvatarPickerOpen(false);
    } catch (reason) {
      setAvatarError((reason as Error).message || "头像保存失败");
      setAvatarPickerOpen(false);
    } finally {
      setSavingAvatar(false);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-8">
        {!available ? (
          <Alert status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>个人主页暂时加载不了</Alert.Title>
              <Alert.Description>请稍后再试。</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : loading ? (
          <p
            className="m-0 flex items-center gap-2 py-10 text-sm text-muted"
            role="status"
          >
            <Spinner color="current" size="sm" />
            正在加载个人主页…
          </p>
        ) : (
          <>
            <section aria-labelledby="profile-reviews-heading">
              <Typography
                className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
                id="profile-reviews-heading"
                type="h2"
              >
                点评（{reviewCount} 门）
              </Typography>
              {reviews.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  快去写点评吧～先到
                  <RouterAriaLink to="/courses" className="text-accent">
                    课程列表
                  </RouterAriaLink>
                  找到你上过的课。
                </p>
              ) : (
                <div className="mt-2" role="list" aria-label="我的点评">
                  {reviews.map((review, index) => (
                    <div key={review.id} role="listitem">
                      {index > 0 ? <Separator /> : null}
                      <div className="py-3">
                        <ProfileReviewItem review={review} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="profile-follows-heading">
              <Typography
                className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
                id="profile-follows-heading"
                type="h2"
              >
                关注（{followCount} 门）
              </Typography>
              {follows.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  还没有关注的课程。在课程页点「关注」，有新点评时会收到消息。
                </p>
              ) : (
                <div className="mt-2" role="list" aria-label="我的关注">
                  {follows.map((follow, index) => (
                    <div
                      key={`${follow.course_id}:${follow.teacher_id}`}
                      role="listitem"
                    >
                      {index > 0 ? <Separator /> : null}
                      <p className="m-0 py-3 text-sm">
                        <RouterAriaLink
                          to={relationHref(follow.course_id, follow.teacher_id)}
                          className="text-accent"
                        >
                          {follow.course_name}
                          {follow.teacher_name
                            ? `（${follow.teacher_name}）`
                            : ""}
                        </RouterAriaLink>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <aside className="min-w-0 self-start">
        <Card role="article" aria-labelledby="profile-card-heading">
          <Card.Header className="items-center text-center">
            <Popover isOpen={avatarPickerOpen} onOpenChange={setAvatarPickerOpen}>
              <Button
                aria-label="更换官方头像"
                isIconOnly
                isPending={savingAvatar}
                variant="ghost"
              >
                <AnonymousAvatar avatarKey={avatarKey} size="lg" />
              </Button>
              <Popover.Content>
                <Popover.Dialog aria-label="选择官方头像">
                  <ToggleButtonGroup
                    aria-label="选择官方头像"
                    className="flex flex-wrap justify-center"
                    disallowEmptySelection
                    isDetached
                    isDisabled={savingAvatar}
                    selectedKeys={[String(avatarKey)]}
                    selectionMode="single"
                    size="sm"
                    onSelectionChange={(keys) => {
                      const key = firstSelectedKey(keys);
                      if (key == null) return;
                      void changeAvatar(Number(key));
                    }}
                  >
                    {HEROUI_AVATAR_PLACEHOLDERS.map((src, key) => (
                      <ToggleButton
                        key={src}
                        aria-label={`选择官方头像 ${key + 1}`}
                        id={String(key)}
                        isIconOnly
                      >
                        <Avatar size="sm">
                          <Avatar.Image alt="" src={src} />
                          <Avatar.Fallback>匿</Avatar.Fallback>
                        </Avatar>
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Card.Title id="profile-card-heading">
              {handle || "我的主页"}
            </Card.Title>
          </Card.Header>
          <Card.Content>
            {avatarError ? (
              <Alert className="mb-3" status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>头像未能保存</Alert.Title>
                  <Alert.Description>{avatarError}</Alert.Description>
                </Alert.Content>
                <Button
                  size="sm"
                  variant="danger"
                  onPress={() => {
                    const key = lastAvatarAttemptRef.current;
                    if (key != null && key !== avatarKey) void changeAvatar(key);
                    else setAvatarPickerOpen(true);
                  }}
                >
                  重试
                </Button>
              </Alert>
            ) : null}
            <dl className="m-0 grid gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">点评</dt>
                <dd className="m-0 tabular">
                  {statValue ? reviewCount : "—"} 门
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">关注</dt>
                <dd className="m-0 tabular">
                  {statValue ? followCount : "—"} 门
                </dd>
              </div>
            </dl>
          </Card.Content>
        </Card>
      </aside>
    </div>
  );
}
