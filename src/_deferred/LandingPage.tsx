import { Button, Input } from "@heroui/react";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function LandingPage() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    navigate(query ? `/courses?q=${encodeURIComponent(query)}` : "/courses");
  }

  return (
    <section className="mx-auto flex min-h-[76vh] max-w-[1100px] flex-col items-center justify-center gap-7 px-4 text-center sm:px-5">
      <h1 className="slogan-serif m-0 text-[clamp(34px,5.5vw,58px)] leading-[1.25]">
        关于一门课，
        <br />
        上过的人最清楚。
      </h1>
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-[560px] flex-col gap-2 sm:flex-row sm:items-center"
      >
        <Input
          aria-label="查找课程、课号或教师"
          fullWidth
          placeholder="课程、课号或教师"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" className="sm:shrink-0">
          查找
        </Button>
      </form>
      <Link to="/courses" className="text-muted underline-offset-4 hover:text-foreground">
        进入课程目录 →
      </Link>
    </section>
  );
}
