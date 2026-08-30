/**
 * PROTOTYPE — public-user-follow（throwaway; not production-ready）。
 *
 * Question: 公开主页右侧「公开编号」卡片里，关注按钮放在哪里、用哪个
 * HeroUI 官方 variant/size 最合适？只比较官方组件组合，不引入自定义皮肤。
 *
 * A — 当前方案：primary · 默认尺寸，放在昵称下、统计上（生产已落此版）
 * B — primary sm：同一位置，按钮小一号
 * C — secondary：同一位置，弱化主操作
 * D — outline：同一位置，描边更轻
 * E — ghost：同一位置，最轻
 * F — 统计下方：primary 回到 Card.Footer 位置（原布局）
 * G — 标题行右侧：primary sm 与昵称同一行，靠右
 *
 * 挂载：/prototype?module=public-user-follow&variant=A…G（DEV only）。
 */
import { Button, Card } from "@heroui/react";
import { AnonymousAvatar } from "../components/AnonymousAvatar";

export type PublicUserFollowVariantKey = "A" | "B" | "C" | "D" | "E" | "F" | "G";

const KEYS: PublicUserFollowVariantKey[] = ["A", "B", "C", "D", "E", "F", "G"];

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
    lookFor: "当前生产方案：默认尺寸主按钮，放在昵称与统计之间",
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
};

function DemoStats() {
  return (
    <dl className="m-0 grid gap-3 text-sm">
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
    </dl>
  );
}

function DemoFollowButton({
  variant,
  size,
}: {
  variant: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <Button variant={variant} size={size}>
      关注
    </Button>
  );
}

function VariantCard({ variantKey }: { variantKey: PublicUserFollowVariantKey }) {
  const hint = VARIANT_HINT[variantKey];
  return (
    <Card className="gap-6" aria-label={`公开编号 · ${hint.title}`}>
      <Card.Header className="items-center text-center">
        <AnonymousAvatar avatarKey={0} size="lg" />
        {variantKey === "G" ? (
          <div className="flex w-full items-center justify-between gap-2">
            <Card.Title>匿名用户#000000</Card.Title>
            <DemoFollowButton variant="primary" size="sm" />
          </div>
        ) : (
          <>
            <Card.Title>匿名用户#000000</Card.Title>
            {variantKey === "F" ? null : (
              <DemoFollowButton
                variant={
                  variantKey === "C"
                    ? "secondary"
                    : variantKey === "D"
                      ? "outline"
                      : variantKey === "E"
                        ? "ghost"
                        : "primary"
                }
                size={variantKey === "B" ? "sm" : undefined}
              />
            )}
          </>
        )}
      </Card.Header>
      <Card.Content>
        <DemoStats />
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
