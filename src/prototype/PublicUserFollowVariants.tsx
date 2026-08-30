/**
 * PROTOTYPE — public-user-follow（throwaway; not production-ready）。
 *
 * Question: 公开主页右侧「公开编号」卡片里，关注按钮放在哪里、用哪个
 * HeroUI 官方 variant/size 最合适？只比较官方组件组合，不引入自定义皮肤。
 *
 * A — primary · 默认尺寸，放在昵称下、统计上
 * B — primary sm：同一位置，按钮小一号
 * C — secondary：同一位置，弱化主操作
 * D — outline：同一位置，描边更轻
 * E — ghost：同一位置，最轻
 * F — 统计下方：primary 回到 Card.Footer 位置（原布局）
 * G — 标题行右侧：primary sm 与昵称同一行，靠右
 * H — ghost sm 融入统计区：按钮作为统计区第一行，与「关注了/被关注/点评了」同高同距
 * I — 统计行内：把「关注」做成统计区里的一行动作，左侧标签右侧按钮
 * J — E + PersonPlus 图标：ghost 按钮带人形加号，下方带分隔线（生产已落此版）
 * K — H + PersonPlus 图标：统计区第一行 ghost sm 带人形加号
 * L — E + Heart 图标：ghost 按钮带空心心形
 * M — 头像昵称靠左，PersonPlus 图标按钮居右
 *
 * 挂载：/u/000000?module=public-user-follow&variant=A…M（DEV only）。
 */
import { Heart, PersonPlus } from "@gravity-ui/icons";
import { Button, Card, Separator } from "@heroui/react";
import { AnonymousAvatar } from "../components/AnonymousAvatar";

export type PublicUserFollowVariantKey =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M";

const KEYS: PublicUserFollowVariantKey[] = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
];

export function isPublicUserFollowVariantKey(
  key: string,
): key is PublicUserFollowVariantKey {
  return (KEYS as string[]).includes(key);
}

const VARIANT_HINT: Record<
  PublicUserFollowVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — 昵称下 · primary",
    lookFor: "默认尺寸主按钮，放在昵称与统计之间",
  },
  B: {
    title: "B — 昵称下 · primary sm",
    lookFor: "同一位置，按钮小一号，卡片里更不抢",
  },
  C: {
    title: "C — 昵称下 · secondary",
    lookFor: "同一位置，次一级强调，关注不是主操作",
  },
  D: {
    title: "D — 昵称下 · outline",
    lookFor: "同一位置，描边按钮，和统计数字放一起更轻",
  },
  E: {
    title: "E — 昵称下 · ghost",
    lookFor: "同一位置，最轻，只留文字与悬停态",
  },
  F: {
    title: "F — 统计下方 · primary",
    lookFor: "原布局：按钮回到卡片底部，统计数字之上无动作",
  },
  G: {
    title: "G — 标题行右侧 · primary sm",
    lookFor: "小主按钮与昵称同一行，靠右；头像独占一行",
  },
  H: {
    title: "H — ghost sm 融入统计区",
    lookFor: "按钮作为统计区第一行，与下方统计同高同距，不再单独悬浮",
  },
  I: {
    title: "I — 统计行内动作",
    lookFor: "把「关注」做成统计区里的一行：左侧标签，右侧 ghost 按钮",
  },
  J: {
    title: "J — E + PersonPlus 图标",
    lookFor: "ghost 按钮带人形加号，下方带分隔线；生产已落此版",
  },
  K: {
    title: "K — H + PersonPlus 图标",
    lookFor: "统计区第一行 ghost sm 带人形加号，融入统计同时有图标",
  },
  L: {
    title: "L — E + Heart 图标",
    lookFor: "ghost 按钮带空心心形，偏「收藏/喜欢」语气",
  },
  M: {
    title: "M — 头像靠左 · PersonPlus 居右",
    lookFor: "头像与昵称左对齐，右侧只放一个 PersonPlus 图标按钮",
  },
};

function DemoStatsRows() {
  return (
    <>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">关注了</dt>
        <dd className="m-0 tabular">0 人</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">被关注</dt>
        <dd className="m-0 tabular">0 人</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">点评了</dt>
        <dd className="m-0 tabular">156 门课程</dd>
      </div>
    </>
  );
}

function DemoStats() {
  return (
    <dl className="m-0 grid gap-3 text-sm">
      <DemoStatsRows />
    </dl>
  );
}

function DemoFollowButton({
  variant,
  size,
  icon,
}: {
  variant: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md";
  icon?: "person-plus" | "heart";
}) {
  return (
    <Button variant={variant} size={size}>
      {icon === "person-plus" ? <PersonPlus aria-hidden /> : null}
      {icon === "heart" ? <Heart aria-hidden /> : null}
      关注
    </Button>
  );
}

function VariantCard({ variantKey }: { variantKey: PublicUserFollowVariantKey }) {
  const hint = VARIANT_HINT[variantKey];
  const inHeader = ["A", "B", "C", "D", "E", "J", "L"].includes(variantKey);
  const isJ = variantKey === "J";
  return (
    <Card className={isJ ? "gap-3" : "gap-6"} aria-label={`公开编号 · ${hint.title}`}>
      <Card.Header
        className={
          variantKey === "M"
            ? "flex-row items-center justify-between gap-3 text-left"
            : isJ
              ? "items-center gap-2 text-center"
              : "items-center text-center"
        }
      >
        {variantKey === "M" ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <AnonymousAvatar avatarKey={0} size="lg" />
              <Card.Title>匿名用户#000000</Card.Title>
            </div>
            <Button aria-label="关注" isIconOnly variant="ghost" size="sm">
              <PersonPlus aria-hidden />
            </Button>
          </>
        ) : (
          <>
            <AnonymousAvatar avatarKey={0} size="lg" />
            {variantKey === "G" ? (
              <div className="flex w-full items-center justify-between gap-2">
                <Card.Title>匿名用户#000000</Card.Title>
                <DemoFollowButton variant="primary" size="sm" />
              </div>
            ) : (
              <>
                <Card.Title>匿名用户#000000</Card.Title>
                {inHeader ? (
                  <DemoFollowButton
                    variant={
                      variantKey === "C"
                        ? "secondary"
                        : variantKey === "D"
                          ? "outline"
                          : variantKey === "E" || variantKey === "J" || variantKey === "L"
                            ? "ghost"
                            : "primary"
                    }
                    size={variantKey === "B" ? "sm" : undefined}
                    icon={
                      variantKey === "J"
                        ? "person-plus"
                        : variantKey === "L"
                          ? "heart"
                          : undefined
                    }
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </Card.Header>
      {isJ ? <Separator /> : null}
      <Card.Content>
        {variantKey === "H" || variantKey === "K" ? (
          <dl className="m-0 grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">关注</dt>
              <dd className="m-0">
                <DemoFollowButton
                  variant="ghost"
                  size="sm"
                  icon={variantKey === "K" ? "person-plus" : undefined}
                />
              </dd>
            </div>
            <DemoStatsRows />
          </dl>
        ) : variantKey === "I" ? (
          <dl className="m-0 grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">关注这个用户</dt>
              <dd className="m-0">
                <DemoFollowButton variant="ghost" size="sm" />
              </dd>
            </div>
            <DemoStatsRows />
          </dl>
        ) : (
          <DemoStats />
        )}
      </Card.Content>
      {variantKey === "F" ? (
        <Card.Footer className="flex flex-col items-center gap-2">
          <DemoFollowButton variant="primary" />
        </Card.Footer>
      ) : null}
    </Card>
  );
}

export function PublicUserFollowPrototype({
  variant,
}: {
  variant: PublicUserFollowVariantKey;
}) {
  const hint = VARIANT_HINT[variant];
  return (
    <div data-prototype="public-user-follow" data-variant={variant}>
      <div
        className="mb-4 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-muted"
        role="note"
      >
        <div>
          <strong className="text-foreground">{hint.title}</strong>
          <span className="mx-1.5 text-border">·</span>
          看：{hint.lookFor}
        </div>
        <div className="mt-1.5 text-[11px] text-muted">
          只比较 HeroUI 官方 Button variant/size 与位置；不调用生产接口，不引入自定义皮肤。
        </div>
      </div>
      <div className="mx-auto w-full max-w-[16rem]">
        <VariantCard variantKey={variant} />
      </div>
    </div>
  );
}
