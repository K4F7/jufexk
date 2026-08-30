/**
 * 个人主页 /profile（#459 / #493）：展示当前登录普通用户的公开编号、
 * 官方头像、自己的点评与关注的任课关系。页面不出现邮箱、学号或 users.id。
 *
 * 窄屏对齐公开作者页：身份一行（头像 + 编号）+ 四列数字条 + Tabs 切点评/关注。
 * md+ 冻结现有两栏：左侧两张 Card，右侧居中身份卡 + 定义列表。
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
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  AnonymousAvatar,
  HEROUI_AVATAR_PLACEHOLDERS,
} from "../components/AnonymousAvatar";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import {
  isDevAtlasSession,
  previewEmptyProfile,
  previewFilledProfile,
  readDevPreviewOrFilled,
} from "../lib/dev-preview";
import { formatReviewDate } from "../lib/review-date";
import type { UserProfile, UserProfileFollow, UserProfileReview } from "../lib/types";
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
    <article
      role="listitem"
      className="min-w-0 border-b border-separator py-3 last:border-b-0 md:border-b-0 sm:py-4"
    >
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 sm:gap-x-3">
        <p className="m-0 min-w-0 break-words text-[calc(13/15*1rem)] leading-6 [overflow-wrap:anywhere] sm:text-sm">
          <RouterAriaLink
            to={relationHref(review.course_id, review.teacher_id)}
            className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-accent max-sm:min-h-[44px] max-sm:py-1.5"
          >
            {review.course_name}
            {review.teacher_name ? `（${review.teacher_name}）` : ""}
          </RouterAriaLink>{" "}
          <ReviewStatusChip status={review.status} />
        </p>
        {date ? (
          <time
            className="min-w-0 max-w-full whitespace-normal break-words text-[calc(12/15*1rem)] text-muted sm:text-xs"
            dateTime={date}
          >
            {date}
          </time>
        ) : null}
      </header>
      {excerpt ? (
        <p className="m-0 mt-1 min-w-0 line-clamp-2 break-words text-[calc(13/15*1rem)] [overflow-wrap:anywhere] sm:text-sm">
          {excerpt}
        </p>
      ) : null}
    </article>
  );
}

function ProfileFollowItem({ follow }: { follow: UserProfileFollow }) {
  return (
    <div className="min-w-0 border-b border-separator py-3 last:border-b-0 sm:py-4">
      <p className="m-0 min-w-0 break-words text-[calc(13/15*1rem)] [overflow-wrap:anywhere] sm:text-sm">
        <RouterAriaLink
          to={relationHref(follow.course_id, follow.teacher_id)}
          className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-accent max-sm:min-h-[44px] max-sm:py-1.5"
        >
          {follow.course_name}
          {follow.teacher_name ? `（${follow.teacher_name}）` : ""}
        </RouterAriaLink>
      </p>
    </div>
  );
}

function ProfileAvatarPicker({
  avatarKey,
  isOpen,
  savingAvatar,
  onOpenChange,
  onSelect,
}: {
  avatarKey: number;
  isOpen: boolean;
  savingAvatar: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: number) => void;
}) {
  return (
    <Popover isOpen={isOpen} onOpenChange={onOpenChange}>
      <Button
        aria-label="更换官方头像"
        className="shrink-0"
        isIconOnly
        isPending={savingAvatar}
        variant="ghost"
      >
        <AnonymousAvatar
          avatarKey={avatarKey}
          className="md:hidden"
          size="sm"
        />
        <AnonymousAvatar
          avatarKey={avatarKey}
          className="max-md:hidden"
          size="lg"
        />
      </Button>
      <Popover.Content className="max-w-[calc(100vw-2rem)]">
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
              onSelect(Number(key));
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
  );
}

function ProfileIdentityCard({
  avatarError,
  avatarKey,
  avatarPickerOpen,
  followerCount,
  followingUserCount,
  followCount,
  handle,
  reviewCount,
  savingAvatar,
  statValue,
  isMd,
  onRetryAvatar,
  onSelectAvatar,
  onAvatarOpenChange,
}: {
  avatarError: string;
  avatarKey: number;
  avatarPickerOpen: boolean;
  followerCount: number;
  followingUserCount: number;
  followCount: number;
  handle: string;
  reviewCount: number;
  savingAvatar: boolean;
  statValue: boolean;
  isMd: boolean;
  onRetryAvatar: () => void;
  onSelectAvatar: (key: number) => void;
  onAvatarOpenChange: (open: boolean) => void;
}) {
  const heading = handle || "我的主页";
  const following = statValue ? followingUserCount : "—";
  const followers = statValue ? followerCount : "—";
  const courses = statValue ? followCount : "—";
  const reviews = statValue ? reviewCount : "—";

  return (
    <Card
      className="min-w-0 gap-4 max-md:gap-2 sm:gap-6"
      role="article"
      aria-labelledby="profile-card-heading"
    >
      <Card.Header className="w-full items-center gap-3 text-center max-md:flex-row max-md:text-start md:flex-col">
        <ProfileAvatarPicker
          avatarKey={avatarKey}
          isOpen={avatarPickerOpen}
          savingAvatar={savingAvatar}
          onOpenChange={onAvatarOpenChange}
          onSelect={onSelectAvatar}
        />
        <Card.Title
          className="min-w-0 max-md:flex-1 max-md:break-words"
          id="profile-card-heading"
        >
          {heading}
        </Card.Title>
      </Card.Header>
      {isMd ? null : <Separator />}
      <Card.Content>
        {avatarError ? (
          <Alert className="mb-3" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>头像未能保存</Alert.Title>
              <Alert.Description>{avatarError}</Alert.Description>
            </Alert.Content>
            <Button size="sm" variant="danger" onPress={onRetryAvatar}>
              重试
            </Button>
          </Alert>
        ) : null}
        {isMd ? (
          <dl className="m-0 grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">关注了</dt>
              <dd className="m-0 tabular">{following} 人</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">被关注</dt>
              <dd className="m-0 tabular">{followers} 人</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">关注了</dt>
              <dd className="m-0 tabular">{courses} 门课程</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">点评了</dt>
              <dd className="m-0 tabular">{reviews} 门课程</dd>
            </div>
          </dl>
        ) : (
          <dl className="m-0 grid grid-cols-4 text-center">
            <div className="min-w-0">
              <dd className="m-0 font-medium tabular">{following}</dd>
              <dt className="text-[calc(12/15*1rem)] text-muted">关注</dt>
            </div>
            <div className="min-w-0">
              <dd className="m-0 font-medium tabular">{followers}</dd>
              <dt className="text-[calc(12/15*1rem)] text-muted">被关注</dt>
            </div>
            <div className="min-w-0">
              <dd className="m-0 font-medium tabular">{courses}</dd>
              <dt className="text-[calc(12/15*1rem)] text-muted">关注课</dt>
            </div>
            <div className="min-w-0">
              <dd className="m-0 font-medium tabular">{reviews}</dd>
              <dt className="text-[calc(12/15*1rem)] text-muted">点评</dt>
            </div>
          </dl>
        )}
      </Card.Content>
    </Card>
  );
}

function ProfileReviewList({ reviews }: { reviews: UserProfileReview[] }) {
  return (
    <div role="list" aria-label="我的点评">
      {reviews.map((review) => (
        <ProfileReviewItem key={review.id} review={review} />
      ))}
    </div>
  );
}

function ProfileFollowList({ follows }: { follows: UserProfileFollow[] }) {
  return (
    <div role="list" aria-label="我的关注">
      {follows.map((follow) => (
        <div key={`${follow.course_id}:${follow.teacher_id}`} role="listitem">
          <ProfileFollowItem follow={follow} />
        </div>
      ))}
    </div>
  );
}

export function ProfilePage() {
  const { viewer, ready, applySession } = useViewer();
  const [searchParams] = useSearchParams();
  const isMd = useMediaQuery("(min-width: 48rem)");
  const preview = readDevPreviewOrFilled(searchParams);
  const skipGate = isDevAtlasSession(searchParams) || preview === "filled";
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const lastAvatarAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    if (preview === "error") {
      setProfile(null);
      setAvailable(false);
      setLoading(false);
      return;
    }
    if (preview === "empty") {
      setProfile(previewEmptyProfile());
      setAvailable(true);
      setLoading(false);
      return;
    }
    if (preview === "filled") {
      setProfile(previewFilledProfile());
      setAvailable(true);
      setLoading(false);
      return;
    }
    if (!ready) return;
    if (!viewer.authenticated) {
      if (skipGate) {
        setProfile(previewEmptyProfile());
        setAvailable(true);
        setLoading(false);
      }
      return;
    }
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
  }, [ready, viewer.authenticated, preview, skipGate]);

  if (!ready && !skipGate) {
    return (
      <section aria-label="个人主页" className="py-8">
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在读取登录状态…
        </p>
      </section>
    );
  }

  if (!viewer.authenticated && !skipGate) {
    const from = encodeURIComponent("/profile");
    return <Navigate to={`${viewer.loginPath}?from=${from}`} replace />;
  }

  const reviews = profile?.reviews ?? [];
  const follows = profile?.follows ?? [];
  const reviewCount = profile?.review_count ?? reviews.length;
  const followCount = profile?.follow_count ?? follows.length;
  const followingUserCount = profile?.following_user_count ?? 0;
  const followerCount = profile?.follower_count ?? 0;
  const handle =
    profile?.handle ||
    (profile?.public_code != null
      ? formatPublicHandle(profile.public_code)
      : "");
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
      applySession({
        ...viewer,
        avatar_key: updated.avatar_key,
        handle: updated.handle ?? viewer.handle,
      });
      setAvatarPickerOpen(false);
    } catch (reason) {
      setAvatarError((reason as Error).message || "头像保存失败");
      setAvatarPickerOpen(false);
    } finally {
      setSavingAvatar(false);
    }
  };

  const identity = (
    <ProfileIdentityCard
      avatarError={avatarError}
      avatarKey={avatarKey}
      avatarPickerOpen={avatarPickerOpen}
      followerCount={followerCount}
      followingUserCount={followingUserCount}
      followCount={followCount}
      handle={handle}
      reviewCount={reviewCount}
      savingAvatar={savingAvatar}
      statValue={statValue}
      onAvatarOpenChange={setAvatarPickerOpen}
      onSelectAvatar={(key) => void changeAvatar(key)}
      onRetryAvatar={() => {
        const key = lastAvatarAttemptRef.current;
        if (key != null && key !== avatarKey) void changeAvatar(key);
        else setAvatarPickerOpen(true);
      }}
    />
  );

  return (
    <div className="flex flex-col-reverse gap-3 md:grid md:grid-cols-[minmax(0,1fr)_16rem] md:gap-8">
      <div className="min-w-0 space-y-6 md:space-y-8">
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
            {!isMd ? (
              <Tabs>
                <Tabs.ListContainer>
                  <Tabs.List aria-label="点评与关注">
                    <Tabs.Tab id="reviews">
                      点评（{reviewCount} 门）
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="follows">
                      <Tabs.Separator />
                      关注（{followCount} 门）
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
                <Tabs.Panel className="pt-3" id="reviews">
                  {reviews.length === 0 ? (
                    <p className="m-0 text-[calc(13/15*1rem)] text-muted">
                      快去写点评吧～先到
                      <RouterAriaLink to="/courses">课程列表</RouterAriaLink>
                      找到你上过的课。
                    </p>
                  ) : (
                    <ProfileReviewList reviews={reviews} />
                  )}
                </Tabs.Panel>
                <Tabs.Panel className="pt-3" id="follows">
                  {follows.length === 0 ? (
                    <p className="m-0 text-[calc(13/15*1rem)] text-muted">
                      还没有关注的课程。在课程页点「关注」，有新点评时会收到消息。
                    </p>
                  ) : (
                    <ProfileFollowList follows={follows} />
                  )}
                </Tabs.Panel>
              </Tabs>
            ) : (
              <>
                <section aria-labelledby="profile-reviews-heading">
                  <Card className="min-w-0">
                    <Card.Header className="gap-3">
                      <Card.Title id="profile-reviews-heading">
                        点评（{reviewCount} 门）
                      </Card.Title>
                      {reviews.length === 0 ? (
                        <Card.Description>
                          快去写点评吧～先到
                          <RouterAriaLink to="/courses">课程列表</RouterAriaLink>
                          找到你上过的课。
                        </Card.Description>
                      ) : null}
                    </Card.Header>
                    {reviews.length > 0 ? (
                      <Card.Content className="pt-0">
                        <ProfileReviewList reviews={reviews} />
                      </Card.Content>
                    ) : null}
                  </Card>
                </section>

                <section aria-labelledby="profile-follows-heading">
                  <Card className="min-w-0">
                    <Card.Header className="gap-3">
                      <Card.Title id="profile-follows-heading">
                        关注（{followCount} 门）
                      </Card.Title>
                      {follows.length === 0 ? (
                        <Card.Description>
                          还没有关注的课程。在课程页点「关注」，有新点评时会收到消息。
                        </Card.Description>
                      ) : null}
                    </Card.Header>
                    {follows.length > 0 ? (
                      <Card.Content className="pt-0">
                        <ProfileFollowList follows={follows} />
                      </Card.Content>
                    ) : null}
                  </Card>
                </section>
              </>
            )}
          </>
        )}
      </div>

      <aside className="min-w-0 md:self-start">{identity}</aside>
    </div>
  );
}
