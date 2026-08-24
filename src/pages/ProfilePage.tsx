/**
 * 个人主页 /profile（#459 / #493）：展示当前登录普通用户的公开编号、
 * 官方头像、自己的点评与关注的任课关系。页面不出现邮箱、学号或 users.id。
 */
import { Alert, Avatar, Button, Card, Chip, Popover, Spinner, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  HEROUI_AVATAR_PLACEHOLDERS,
  officialAvatarSrc,
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
    <li className="border-b border-separator py-3 last:border-b-0">
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
    </li>
  );
}

export function ProfilePage() {
  const { viewer, ready } = useViewer();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

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

  const changeAvatar = async (nextKey: number) => {
    if (savingAvatar || nextKey === avatarKey) {
      setAvatarPickerOpen(false);
      return;
    }
    setSavingAvatar(true);
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
              <Alert.Title>数据接口尚未就绪</Alert.Title>
              <Alert.Description>
                个人主页数据接口（#459）尚未上线，点评与关注列表暂时无法加载，请稍后再来。
              </Alert.Description>
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
                <ul className="m-0 mt-2 list-none p-0">
                  {reviews.map((review) => (
                    <ProfileReviewItem key={review.id} review={review} />
                  ))}
                </ul>
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
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {follows.map((follow) => (
                    <li key={`${follow.course_id}:${follow.teacher_id}`}>
                      <RouterAriaLink
                        to={relationHref(follow.course_id, follow.teacher_id)}
                        className="text-sm text-accent"
                      >
                        {follow.course_name}
                        {follow.teacher_name ? `（${follow.teacher_name}）` : ""}
                      </RouterAriaLink>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <aside className="min-w-0">
        <Card role="article" aria-labelledby="profile-card-heading">
          <Card.Header className="items-center text-center">
            <Popover isOpen={avatarPickerOpen} onOpenChange={setAvatarPickerOpen}>
              <Button
                aria-label="更换官方头像"
                isIconOnly
                isPending={savingAvatar}
                variant="ghost"
              >
                <Avatar size="lg">
                  <Avatar.Image alt="" src={officialAvatarSrc(avatarKey)} />
                  <Avatar.Fallback>匿</Avatar.Fallback>
                </Avatar>
              </Button>
              <Popover.Content>
                <Popover.Dialog>
                  <Popover.Heading>选择官方头像</Popover.Heading>
                  <div
                    role="group"
                    aria-label="选择官方头像"
                    className="mt-2 flex flex-wrap justify-center gap-2"
                  >
                    {HEROUI_AVATAR_PLACEHOLDERS.map((src, key) => (
                      <Button
                        key={src}
                        isIconOnly
                        size="sm"
                        variant={avatarKey === key ? "primary" : "outline"}
                        aria-label={`选择官方头像 ${key + 1}`}
                        aria-pressed={avatarKey === key}
                        isPending={savingAvatar && avatarKey !== key}
                        onPress={() => void changeAvatar(key)}
                      >
                        <Avatar size="sm">
                          <Avatar.Image alt="" src={src} />
                          <Avatar.Fallback>匿</Avatar.Fallback>
                        </Avatar>
                      </Button>
                    ))}
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Card.Title id="profile-card-heading">
              {handle || "我的主页"}
            </Card.Title>
            <Card.Description>
              公开编号只用于识别作者，不是学号或内部身份。
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-3 text-sm">
              <span>点评了 {available && !loading ? reviewCount : "—"} 门课程</span>
              <span>关注了 {available && !loading ? followCount : "—"} 门课程</span>
            </div>
          </Card.Content>
        </Card>
      </aside>
    </div>
  );
}
