import { Button, Card, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RouterAriaLink } from "../../components/RouterAriaLink";
import { AdminGate, AdminPageHeader } from "./AdminGate";

/**
 * 管理首页（对齐 icourse：没有独立后台首页，这里只做参考目录）。
 * 屏蔽/删除点评、查询作者、课程管理员公告都嵌在课程详情页上。
 */
export function AdminHubPage() {
  const navigate = useNavigate();
  const [userRef, setUserRef] = useState("");

  const goUser = () => {
    const ref = userRef.trim();
    if (ref) navigate(`/admin/users/${encodeURIComponent(ref)}`);
  };

  return (
    <AdminGate>
      <section>
        <AdminPageHeader
          title="管理后台"
          description="全站 Banner、公告栏与管理员学号在这里维护；屏蔽点评、查询作者、课程设置管理员公告嵌在课程详情页上。"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <Card.Header>
              <Card.Title>
                <RouterAriaLink className="text-accent" to="/admin/banner">
                  全站 Banner
                </RouterAriaLink>
              </Card.Title>
              <Card.Description>
                顶栏下方的全站公告条；桌面版与移动版分别设置，含设置历史。
              </Card.Description>
            </Card.Header>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>
                <RouterAriaLink className="text-accent" to="/announcements">
                  公告栏
                </RouterAriaLink>
              </Card.Title>
              <Card.Description>
                公开公告列表；管理员可发布、编辑、删除。
              </Card.Description>
            </Card.Header>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>
                <RouterAriaLink className="text-accent" to="/admin/admins">
                  管理员学号
                </RouterAriaLink>
              </Card.Title>
              <Card.Description>
                手动绑定一位或多位校园登录学号；对方登录后即可进入管理分区。
              </Card.Description>
            </Card.Header>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>用户禁言</Card.Title>
              <Card.Description>
                输入用户引用进入禁言管理。用户引用来自「查询作者资料」的管理员邮件，不对外公开。
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  goUser();
                }}
              >
                <TextField
                  className="flex-1"
                  name="userRef"
                  value={userRef}
                  onChange={setUserRef}
                >
                  <Label>用户引用</Label>
                  <Input placeholder="例如作者资料邮件中的引用" />
                </TextField>
                <Button type="submit" variant="secondary">
                  前往
                </Button>
              </form>
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>课程页上的管理动作</Card.Title>
              <Card.Description>
                在课程详情页逐条点评上屏蔽 / 解除屏蔽 / 删除 / 查询作者资料；课程头部可设置管理员公告。
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <RouterAriaLink className="text-accent" to="/courses">
                前往课程目录 →
              </RouterAriaLink>
            </Card.Content>
          </Card>
        </div>
      </section>
    </AdminGate>
  );
}
