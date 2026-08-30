import { buttonVariants, Card } from "@heroui/react";
import { RouterAriaLink } from "../components/RouterAriaLink";

export function NotFoundPage() {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="mx-auto w-full max-w-xl py-4 sm:py-8"
    >
      <Card role="article" aria-labelledby="not-found-heading">
        <Card.Header>
          <Card.Title className="max-sm:text-lg" id="not-found-heading">
            页面不存在
          </Card.Title>
          <Card.Description className="text-pretty">
            这个地址没有对应页面，可能是链接失效或输入有误。
          </Card.Description>
        </Card.Header>
        <Card.Footer>
          <RouterAriaLink
            className={`${buttonVariants({ fullWidth: true })} min-h-[44px] sm:hidden`}
            to="/latest"
          >
            返回首页
          </RouterAriaLink>
          <RouterAriaLink className="max-sm:hidden" to="/latest">
            返回首页
          </RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
