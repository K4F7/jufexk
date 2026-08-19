/**
 * PROTOTYPE — global-search variants (throwaway; not production-ready).
 *
 * Question: 导航栏要不要加统一搜索入口，还是页内搜索（#286）+ 空态救援（#287）就够？
 *
 * A — 维持页内：无顶栏搜索；第一次查询靠目录页 SearchField；搜错实体走 #287 空态链接。
 * B — 顶栏统一入口：Modal + Autocomplete 分组课程/教师（各最多 5 条）；点选进详情，回车进当前目录 ?q=。
 * C — 顶栏只跳转：SearchField 回车进当前目录，结果上方官方 Link 指向另一目录。
 *
 * Mounted via AppShell / catalog pages when ?module=global-search&variant=A|B|C (DEV only).
 */
import {
  Autocomplete,
  Button,
  Description,
  EmptyState,
  Header,
  Label,
  ListBox,
  Modal,
  SearchField,
  Separator,
} from "@heroui/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CatalogEmptyRescueLink } from "../components/CatalogResultsStates";
import { api } from "../lib/api";
import type { Course, Paginated, Teacher } from "../lib/types";
import {
  catalogDetailHref,
  catalogKindFromPath,
  catalogSearchHref,
  crossCatalogHintLabel,
  oppositeCatalog,
  takeSuggestions,
  type CatalogKind,
  type GlobalSearchVariantKey,
} from "./global-search";

export type { GlobalSearchVariantKey };

const FILTER_DELAY = 320;
const SUGGEST_PAGE_SIZE = 5;
const SEARCH_LABEL = "搜索课程或教师";
const SEARCH_PLACEHOLDER = "搜索课程或教师";

const VARIANT_NOTES: Record<GlobalSearchVariantKey, { title: string; first: string; recover: string }> =
  {
    A: {
      title: "A — 维持页内",
      first: "第一次查询：2 次点击 + 输入。点导航进课程或教师页 → 点页内搜索框 → 输入。无顶栏入口。",
      recover: "搜错实体：1 次点击。等空态出现后，点 #287「另一目录有 N 条匹配」链接。",
    },
    B: {
      title: "B — 顶栏分组建议",
      first: "第一次查询：1 次点击 + 输入 + 1 次点选或回车。点顶栏搜索（窄屏先点图标打开 Modal）→ 输入 → 点建议进详情，或回车进当前目录 ?q=。",
      recover: "搜错实体：1 次点击另一分组；或回车后点空态 #287。",
    },
    C: {
      title: "C — 顶栏只跳转",
      first: "第一次查询：1 次点击 + 输入 + 回车。点顶栏搜索（窄屏先点图标）→ 输入 → 回车，落到当前所在目录 ?q=。",
      recover: "搜错实体：1 次点击结果上方「也在另一目录中搜」官方 Link，不必等空态。",
    },
  };

function useCatalogNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const kind = catalogKindFromPath(location.pathname);

  return {
    kind,
    params,
    goToCatalog(query: string, target: CatalogKind = kind) {
      navigate(catalogSearchHref(target, query, params));
    },
    goToDetail(target: CatalogKind, id: number) {
      navigate(catalogDetailHref(target, id, params));
    },
  };
}

function useGroupedSuggestions(query: string) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setCourses([]);
      setTeachers([]);
      setReady(false);
      return;
    }

    const controller = new AbortController();
    setReady(false);
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams({
        q,
        page: "1",
        pageSize: String(SUGGEST_PAGE_SIZE),
      });
      Promise.all([
        api<Paginated<Course>>(`/api/courses?${search}`, {
          signal: controller.signal,
        }),
        api<Paginated<Teacher>>(`/api/teachers?${search}`, {
          signal: controller.signal,
        }),
      ])
        .then(([coursePage, teacherPage]) => {
          setCourses(takeSuggestions(coursePage.items, SUGGEST_PAGE_SIZE));
          setTeachers(takeSuggestions(teacherPage.items, SUGGEST_PAGE_SIZE));
          setReady(true);
        })
        .catch((error: { name?: string }) => {
          if (error?.name === "AbortError") return;
          setCourses([]);
          setTeachers([]);
          setReady(true);
        });
    }, FILTER_DELAY);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { courses, teachers, ready };
}

function parseSuggestionKey(key: string): { kind: CatalogKind; id: number } | null {
  const [kind, rawId] = key.split(":");
  const id = Number(rawId);
  if ((kind !== "courses" && kind !== "teachers") || !Number.isInteger(id)) {
    return null;
  }
  return { kind, id };
}

function GroupedAutocomplete({
  autoFocus = false,
  onPicked,
}: {
  autoFocus?: boolean;
  onPicked?: () => void;
}) {
  const { kind, goToCatalog, goToDetail } = useCatalogNavigation();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(autoFocus);
  const { courses, teachers, ready } = useGroupedSuggestions(value);
  const hasHits = courses.length > 0 || teachers.length > 0;
  const open = focused && Boolean(value.trim()) && (hasHits || ready);

  function submitCatalog(next = value) {
    onPicked?.();
    goToCatalog(next, kind);
  }

  return (
    <Autocomplete
      allowsEmptyCollection
      className="w-full"
      selectionMode="single"
      value={null}
      variant="secondary"
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) setFocused(false);
      }}
      onChange={(key) => {
        const selected = parseSuggestionKey(String(key ?? ""));
        if (!selected) return;
        onPicked?.();
        goToDetail(selected.kind, selected.id);
      }}
    >
      <Label className="sr-only">{SEARCH_LABEL}</Label>
      <Autocomplete.Filter
        filter={() => true}
        inputValue={value}
        onInputChange={setValue}
      >
        <SearchField
          fullWidth
          name="global-search"
          variant="secondary"
          onSubmit={submitCatalog}
        >
          <Label className="sr-only">{SEARCH_LABEL}</Label>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              autoFocus={autoFocus}
              className="w-full"
              placeholder={SEARCH_PLACEHOLDER}
              onFocus={() => setFocused(true)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submitCatalog();
              }}
            />
            <SearchField.ClearButton aria-label="清空搜索" />
          </SearchField.Group>
        </SearchField>
        <Autocomplete.Popover>
          <ListBox
            renderEmptyState={() => <EmptyState>没有匹配的课程或教师</EmptyState>}
          >
            {courses.length > 0 ? (
              <ListBox.Section>
                <Header>课程</Header>
                {courses.map((course) => (
                  <ListBox.Item
                    key={`courses:${course.id}`}
                    id={`courses:${course.id}`}
                    textValue={`${course.name} ${course.code}`}
                  >
                    <Label>{course.name}</Label>
                    <Description>{course.code}</Description>
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            ) : null}
            {courses.length > 0 && teachers.length > 0 ? <Separator /> : null}
            {teachers.length > 0 ? (
              <ListBox.Section>
                <Header>教师</Header>
                {teachers.map((teacher) => (
                  <ListBox.Item
                    key={`teachers:${teacher.id}`}
                    id={`teachers:${teacher.id}`}
                    textValue={`${teacher.name} ${teacher.department}`}
                  >
                    <Label>{teacher.name}</Label>
                    {teacher.department ? (
                      <Description>{teacher.department}</Description>
                    ) : null}
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            ) : null}
          </ListBox>
        </Autocomplete.Popover>
      </Autocomplete.Filter>
    </Autocomplete>
  );
}

function JumpSearchField({
  autoFocus = false,
  onPicked,
}: {
  autoFocus?: boolean;
  onPicked?: () => void;
}) {
  const { kind, goToCatalog } = useCatalogNavigation();
  const [value, setValue] = useState("");

  function submit(next = value) {
    onPicked?.();
    goToCatalog(next, kind);
  }

  return (
    <SearchField
      fullWidth
      name="global-search"
      value={value}
      variant="secondary"
      onChange={setValue}
      onSubmit={submit}
    >
      <Label className="sr-only">{SEARCH_LABEL}</Label>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input
          autoFocus={autoFocus}
          className="w-full"
          placeholder={SEARCH_PLACEHOLDER}
        />
        <SearchField.ClearButton aria-label="清空搜索" />
      </SearchField.Group>
    </SearchField>
  );
}

function NarrowSearchModal({
  title,
  children,
}: {
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Modal>
      <Button
        aria-label={title}
        className="sm:hidden"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={() => setOpen(true)}
      >
        <SearchField.SearchIcon />
      </Button>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>{children(() => setOpen(false))}</Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function VariantBShell() {
  return (
    <div className="flex items-center">
      <div className="hidden w-[16rem] sm:block">
        <GroupedAutocomplete />
      </div>
      <NarrowSearchModal title="搜索课程与教师">
        {(close) => <GroupedAutocomplete autoFocus onPicked={close} />}
      </NarrowSearchModal>
    </div>
  );
}

function VariantCShell() {
  return (
    <div className="flex items-center">
      <div className="hidden w-[16rem] sm:block">
        <JumpSearchField />
      </div>
      <NarrowSearchModal title="搜索当前目录">
        {(close) => <JumpSearchField autoFocus onPicked={close} />}
      </NarrowSearchModal>
    </div>
  );
}

function CompareNote({ variant }: { variant: GlobalSearchVariantKey }) {
  const note = VARIANT_NOTES[variant];
  return (
    <aside
      className="mb-3 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted"
      data-prototype-module="global-search"
      data-variant={variant}
      role="note"
    >
      <div className="font-semibold text-foreground">{note.title}</div>
      <p className="m-0 mt-1">{note.first}</p>
      <p className="m-0 mt-1">{note.recover}</p>
    </aside>
  );
}

export function GlobalSearchCrossCatalogHint({
  catalog,
  query,
}: {
  catalog: CatalogKind;
  query: string;
}) {
  const [params] = useSearchParams();
  const trimmed = query.trim();
  const target = oppositeCatalog(catalog);
  const href = useMemo(
    () => catalogSearchHref(target, trimmed, params),
    [params, target, trimmed],
  );

  if (!trimmed) return null;

  return (
    <p className="mb-3 text-sm" data-prototype-global-search-hint="">
      <CatalogEmptyRescueLink to={href}>
        {crossCatalogHintLabel(catalog, trimmed)}
      </CatalogEmptyRescueLink>
    </p>
  );
}

export function GlobalSearchPrototype({
  variant,
  slot,
}: {
  variant: GlobalSearchVariantKey;
  slot: "shell" | "note";
}) {
  if (slot === "note") return <CompareNote variant={variant} />;
  if (variant === "B") return <VariantBShell />;
  if (variant === "C") return <VariantCShell />;
  return null;
}
