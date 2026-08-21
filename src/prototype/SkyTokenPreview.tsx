/**
 * PROTOTYPE — token swatches + live primitive samples for module "sky-tokens".
 * Question: which density / surface treatment of official Sky for JUFE评课社区?
 */
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  SearchField,
  Separator,
  Surface,
  TextField,
} from "@heroui/react";
import { useState } from "react";
import type { PrototypeVariantDef } from "./modules";

const SAMPLE_TOKENS = [
  "--accent",
  "--accent-foreground",
  "--background",
  "--foreground",
  "--surface",
  "--border",
  "--muted",
  "--success",
  "--warning",
  "--danger",
  "--radius",
  "--field-radius",
] as const;

function TokenSwatch({ name }: { name: string }) {
  const isRadius = name.includes("radius");
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
      <div
        aria-hidden
        className="size-7 shrink-0 rounded border border-border"
        style={
          isRadius
            ? {
                background: "var(--accent)",
                borderRadius: `var(${name})`,
              }
            : { background: `var(${name})` }
        }
      />
      <div className="min-w-0">
        <div className="truncate font-mono text-[11px] font-semibold">{name}</div>
        <div className="truncate font-mono text-[10px] text-muted">
          {isRadius ? "radius token" : "color token"}
        </div>
      </div>
    </div>
  );
}

function setTheme(mode: "light" | "dark" | "system") {
  const fn = (
    window as unknown as {
      __jufexkSetTheme?: (m: "light" | "dark" | "system") => void;
    }
  ).__jufexkSetTheme;
  fn?.(mode);
}

export function SkyTokenPreview({ variant }: { variant: PrototypeVariantDef }) {
  const [query, setQuery] = useState("");

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          PROTOTYPE · sky-tokens
        </p>
        <h2 className="m-0 text-xl font-bold leading-tight">
          {variant.key} — {variant.name}
        </h2>
        <p className="m-0 max-w-3xl text-sm text-muted">{variant.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">预览亮暗：</span>
          <Button size="sm" variant="secondary" onPress={() => setTheme("light")}>
            亮色
          </Button>
          <Button size="sm" variant="secondary" onPress={() => setTheme("dark")}>
            暗色
          </Button>
          <Button size="sm" variant="tertiary" onPress={() => setTheme("system")}>
            跟随系统
          </Button>
        </div>
      </header>

      <section aria-label="Token 色板" className="grid gap-2">
        <h3 className="m-0 text-sm font-bold">Token 色板</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SAMPLE_TOKENS.map((name) => (
            <TokenSwatch key={name} name={name} />
          ))}
        </div>
      </section>

      <section aria-label="组件样本" className="grid gap-3">
        <h3 className="m-0 text-sm font-bold">组件样本</h3>

        <Surface className="grid gap-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">主要操作</Button>
            <Button size="sm" variant="secondary">
              次要
            </Button>
            <Button size="sm" variant="tertiary">
              tertiary
            </Button>
            <Button size="sm" variant="outline">
              outline
            </Button>
            <Button size="sm" variant="ghost">
              ghost
            </Button>
            <Button size="sm" variant="danger">
              危险
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip color="accent" size="sm" variant="primary">
              accent
            </Chip>
            <Chip color="success" size="sm" variant="soft">
              success
            </Chip>
            <Chip color="warning" size="sm" variant="soft">
              warning
            </Chip>
            <Chip color="danger" size="sm" variant="soft">
              danger
            </Chip>
            <Chip size="sm" variant="secondary">
              default
            </Chip>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <SearchField
              fullWidth
              name="proto-search"
              value={query}
              onChange={setQuery}
            >
              <Label>搜索课程</Label>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="搜索课程、课号或教师" />
                <SearchField.ClearButton aria-label="清空" />
              </SearchField.Group>
            </SearchField>
            <TextField name="proto-dept">
              <Label>院系</Label>
              <Input placeholder="例如：会计学院" />
            </TextField>
          </div>
        </Surface>

        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <Card.Header>
              <Card.Title>微观经济学</Card.Title>
              <Card.Description>课号 ECON101 · 专业课 · 经济学院</Card.Description>
            </Card.Header>
            <Card.Content>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular text-accent">4.7</span>
                <span className="text-sm text-muted">/ 5 · 128 则学生投稿</span>
              </div>
            </Card.Content>
            <Card.Footer className="flex gap-2">
              <Button size="sm">打开课程</Button>
              <Button size="sm" variant="secondary">
                查看教师
              </Button>
            </Card.Footer>
          </Card>

          <Surface
            className="rounded-lg border border-border p-4"
            variant="secondary"
          >
            <h3 className="m-0 text-sm font-bold">目录表头示意</h3>
            <p className="mt-1 text-xs text-muted">
              真实表格在 /courses；此处只看 token 对表面、边框与数字强调的影响。
            </p>
            <div className="mt-3 overflow-hidden rounded border border-border bg-surface">
              <div className="grid grid-cols-[5rem_1fr_4rem_4rem] gap-2 border-b border-border bg-surface-secondary px-3 py-2 text-[11px] font-semibold text-muted">
                <span>课号</span>
                <span>课程</span>
                <span className="text-right">评分</span>
                <span className="text-right">投稿</span>
              </div>
              {[
                ["ECON101", "微观经济学", "4.7", "128"],
                ["MATH201", "高等数学", "4.2", "96"],
                ["LAW110", "法理学", "3.9", "41"],
              ].map((row) => (
                <div
                  key={row[0]}
                  className="grid grid-cols-[5rem_1fr_4rem_4rem] gap-2 border-b border-separator px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="font-mono text-xs text-muted">{row[0]}</span>
                  <span className="font-medium">{row[1]}</span>
                  <span className="text-right tabular font-semibold text-accent">
                    {row[2]}
                  </span>
                  <span className="text-right tabular text-muted">{row[3]}</span>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </section>

      <section
        aria-label="当前变体状态"
        className="rounded border border-dashed border-border bg-surface-secondary px-3 py-2 font-mono text-[11px] text-muted"
      >
        state: module=sky-tokens variant={variant.key} theme=
        {`sky-${variant.key.toUpperCase()}`} · success/warning/danger untouched
      </section>
    </div>
  );
}
