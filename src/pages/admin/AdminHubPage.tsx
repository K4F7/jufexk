import { Button, Card, Form, SearchField } from "@heroui/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RouterAriaLink } from "../../components/RouterAriaLink";
import { AdminLayout } from "./AdminGate";

function HubCard({
  title,
  description,
  to,
  action,
  className,
}: {
  title: string;
  description: string;
  to: string;
  action: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      <Card.Footer>
        <RouterAriaLink to={to}>{action}</RouterAriaLink>
      </Card.Footer>
    </Card>
  );
}

/**
 * 管理首页：站点 / 权限 / 课程页动作分组。
 * 屏蔽点评、查询作者、课程管理员公告仍嵌在课程详情页上。
 */
export function AdminHubPage() {
  const navigate = useNavigate();
  const [userRef, setUserRef] = useState("");

  const goUser = (value: string) => {
    const ref = value.trim();
    if (ref) navigate(`/admin/users/${encodeURIComponent(ref)}`);
  };

  return (
    <AdminLayout
      title="管理后台"
      description="全站 Banner 与管理员学号在这里维护；屏蔽点评、查询作者、课程管理员公告嵌在课程详情页上。"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <HubCard
          action="打开 Banner"
          description="顶栏下方的全站公告条；桌面版与移动版分别设置，含设置历史。"
          title="全站 Banner"
          to="/admin/banner"
        />
        <HubCard
          action="打开数据"
          description="注册用户日增长，以及课评浏览、停留和登录尝试。"
          title="数据"
          to="/admin/bi"
        />
        <HubCard
          action="管理员学号"
          description="手动绑定一位或多位校园登录学号；对方登录后即可进入管理分区。"
          title="管理员学号"
          to="/admin/admins"
        />
        <Card>
          <Card.Header>
            <Card.Title>用户禁言</Card.Title>
            <Card.Description>
              输入作者资料邮件中的「站内用户 ID」。禁言期间无法提交评价或认可。
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <Form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                goUser(userRef);
              }}
            >
              <SearchField
                aria-label="站内用户 ID"
                className="min-w-0 flex-1"
                name="userRef"
                value={userRef}
                variant="secondary"
                onChange={setUserRef}
                onSubmit={goUser}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    className="w-full"
                    placeholder="站内用户 ID"
                  />
                  <SearchField.ClearButton aria-label="清空用户 ID" />
                </SearchField.Group>
              </SearchField>
              <Button type="submit" variant="secondary">
                前往
              </Button>
            </Form>
          </Card.Content>
        </Card>
        <HubCard
          action="前往课程目录"
          className="sm:col-span-2"
          description="在课程详情页逐条点评上屏蔽 / 解除屏蔽 / 删除 / 查询作者资料；课程头部可设置管理员公告。"
          title="课程页上的管理动作"
          to="/courses"
        />
      </div>
    </AdminLayout>
  );
}
