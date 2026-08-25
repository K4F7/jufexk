/**
 * 公开作者页 /u/:code（#493）：公开编号、官方头像与已过审点评。
 * #000000 是学长学姐匿名评价，不可关注。
 */
import { Button, Card, Spinner, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnonymousAvatar } from "../components/AnonymousAvatar";
import { DetailErrorAlert } from "../components/DetailFeedback";
import { ReviewNoteContent } from "../components/ReviewNoteContent";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { formatReviewDate } from "../lib/review-date";
import { reviewAnchorId } from "../lib/review-dimensions";
import type { LatestReview, PublicUserProfile } from "../lib/types";
import { formatPublicCode, formatPublicHandle } from "../public-handle";

export function PublicUserPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { viewer, ready } = useViewer();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [error, setError] = useState("");
  const [followError, setFollowError] = useState("");
  const [loading, setLoading] = useState(true);
  const [followPending, setFollowPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setFollowError("");
    api<PublicUserProfile>(`/api/u/${code}`)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((reason) => {
        if (!cancelled) {
          setProfile(null);
          setError((reason as Error).message || "公开主页加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const toggleFollow = async () => {
    if (!profile || profile.reserved || profile.viewer_is_self) return;
    if (!viewer.authenticated) {
      const from = encodeURIComponent(`/u/${formatPublicCode(profile.public_code)}`);
      navigate(`${viewer.loginPath}?from=${from}`);
      return;
    }
    setFollowPending(true);
    setFollowError("");
    try {
      const path = `/api/u/${formatPublicCode(profile.public_code)}/follow`;
      const result = await api<{ viewer_followed: boolean }>(path, {
        method: profile.viewer_followed ? "DELETE" : "PUT",
      });
      setProfile((current) => {
        if (!current) return current;
        const delta = result.viewer_followed === current.viewer_followed
          ? 0
          : result.viewer_followed
            ? 1
            : -1;
        return {
          ...current,
          viewer_followed: result.viewer_followed,
          follower_count: Math.max(0, current.follower_count + delta),
        };
      });
    } catch (reason) {
      setFollowError((reason as Error).message || "关注失败");
    } finally {
      setFollowPending(false);
    }
  };

  if (loading || !ready) {
    return (
      <section aria-label="公开主页" className="py-8">
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在加载公开主页…
        </p>
      </section>
    );
  }

  if (error && !profile) {
    return <DetailErrorAlert title="公开主页加载失败" message={error} />;
  }
  if (!profile) return null;

  const handle = profile.handle || formatPublicHandle(profile.public_code);

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-6">
        <header>
          <Typography
            className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
            type="h1"
          >
            {handle}
          </Typography>
          {profile.note ? (
            <p className="mt-2 text-sm text-muted">{profile.note}</p>
          ) : (
            <p className="mt-2 text-sm text-muted">公开点评</p>
          )}
        </header>
        {profile.reviews.length === 0 ? (
          <p className="text-sm text-muted">暂时还没有公开点评。</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {profile.reviews.map((review) => (
              <PublicUserReviewItem key={review.id} review={review} />
            ))}
          </ul>
        )}
      </div>
      <aside className="min-w-0">
        <Card aria-label="公开编号">
          <Card.Header className="flex-row items-center gap-3">
            <AnonymousAvatar avatarKey={profile.avatar_key} size="lg" />
            <div className="min-w-0">
              <Card.Title>{handle}</Card.Title>
              {profile.reserved ? (
                <Card.Description>来自以前的学长学姐的评价</Card.Description>
              ) : null}
            </div>
          </Card.Header>
          <Card.Content>
            <dl className="m-0 grid gap-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">关注了</dt>
                <dd className="m-0 tabular">{profile.following_count ?? 0} 人</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">被关注</dt>
                <dd className="m-0 tabular">{profile.follower_count ?? 0} 人</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">点评了</dt>
                <dd className="m-0 tabular">{profile.review_count ?? 0} 门课程</dd>
              </div>
            </dl>
          </Card.Content>
          {profile.reserved || profile.viewer_is_self ? null : (
            <Card.Footer className="flex flex-col items-center gap-2">
              <Button
                variant={profile.viewer_followed ? "secondary" : "primary"}
                isPending={followPending}
                onPress={() => void toggleFollow()}
              >
                {profile.viewer_followed ? "取消关注" : "关注"}
              </Button>
              {followError ? (
                <DetailErrorAlert title="关注失败" message={followError} />
              ) : null}
            </Card.Footer>
          )}
        </Card>
      </aside>
    </div>
  );
}

function PublicUserReviewItem({ review }: { review: LatestReview }) {
  const date = formatReviewDate(review.created_at);
  const moreHref = `/courses/${review.course_id}?teacher=${review.teacher_id}#${encodeURIComponent(reviewAnchorId(review.id))}`;
  return (
    <li className="border-b border-separator py-4 last:border-b-0">
      <p className="m-0 text-sm">
        <RouterAriaLink
          to={`/courses/${review.course_id}?teacher=${review.teacher_id}`}
          className="text-accent"
        >
          {review.course_name}
          {review.teacher_name ? `（${review.teacher_name}）` : ""}
        </RouterAriaLink>
      </p>
      {date ? (
        <time className="text-xs text-muted" dateTime={date}>
          {date}
        </time>
      ) : null}
      {review.headline ? (
        <p className="mt-1 mb-0 text-sm font-medium">{review.headline}</p>
      ) : (
        <div className="mt-1">
          <ReviewNoteContent
            comment={review.comment}
            commentFormat={review.comment_format}
          />
        </div>
      )}
      <RouterAriaLink to={moreHref} className="text-sm text-accent">
        查看全文
      </RouterAriaLink>
    </li>
  );
}
