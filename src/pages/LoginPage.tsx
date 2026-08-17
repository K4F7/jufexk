export function LoginPage() {
  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-xl py-8">
      <h1 id="login-heading" className="m-0 text-xl font-bold">
        校内邮箱登录
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        使用江西财经大学邮箱（@jxufe.edu.cn）完成一次性验证后，即可认可有参考价值的任课评价。公开课程、教师和评价页面仍可匿名浏览。
      </p>
      <p className="mt-2 text-sm text-muted">
        这是 Access / session 契约中的登录入口。验证完成后即可返回评价页继续认可；账号管理界面由后续工单承接。
      </p>
    </section>
  );
}
