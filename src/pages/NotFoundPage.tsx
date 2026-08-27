import { Card } from "@heroui/react";
import { RouterAriaLink } from "../components/RouterAriaLink";

export function NotFoundPage() {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="mx-auto w-full max-w-xl py-8"
    >
      <Card role="article" aria-labelledby="not-found-heading">
        <Card.Header>
          <Card.Title id="not-found-heading">页面不存在</Card.Title>
          <Card.Description>这个地址没有对应页面，可能是链接失效或输入有误。</Card.Description>
        </Card.Header>
        <Card.Footer>
          <RouterAriaLink to="/courses">返回首页</RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
