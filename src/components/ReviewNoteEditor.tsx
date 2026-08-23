import {
  Button,
  Input,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";

export type ReviewNoteValue = {
  /** Tiptap 默认输出的 HTML；空文档为空串。 */
  html: string;
  /** 去标签后的纯文本（块间换行），用于 10–1200 字门槛。 */
  text: string;
};

const FORMAT_COMMANDS: Record<string, (editor: Editor) => void> = {
  bold: (editor) => editor.chain().focus().toggleBold().run(),
  italic: (editor) => editor.chain().focus().toggleItalic().run(),
  blockquote: (editor) => editor.chain().focus().toggleBlockquote().run(),
  bulletList: (editor) => editor.chain().focus().toggleBulletList().run(),
  orderedList: (editor) => editor.chain().focus().toggleOrderedList().run(),
};

/** 用户只填裸域名时补 https://；javascript: 等协议直接不应用。 */
function normalizeLinkHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(?:https?:\/\/|mailto:|\/|#|\.)/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return `https://${value}`;
}

/**
 * 补充说明富文本编辑器（issue #400）：Tiptap starter kit 最小子集
 * （加粗、斜体、链接、列表、引用），工具栏用官方 HeroUI 按钮，
 * 不自定义编辑器皮肤。
 */
export function ReviewNoteEditor({
  ariaLabel,
  isInvalid,
  editorRef,
  onChange,
}: {
  ariaLabel: string;
  isInvalid?: boolean;
  editorRef: React.MutableRefObject<Editor | null>;
  onChange: (value: ReviewNoteValue) => void;
}) {
  const [linkRowOpen, setLinkRowOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: "review-note-editable",
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange({
        html: current.isEmpty ? "" : current.getHTML(),
        text: current.getText(),
      });
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  const state = useEditorState({
    editor,
    selector: (context) => ({
      bold: context.editor.isActive("bold"),
      italic: context.editor.isActive("italic"),
      blockquote: context.editor.isActive("blockquote"),
      bulletList: context.editor.isActive("bulletList"),
      orderedList: context.editor.isActive("orderedList"),
      link: context.editor.isActive("link"),
      linkHref: (context.editor.getAttributes("link").href as string) || "",
    }),
  });

  if (!editor) return null;

  const selectedKeys = new Set<Key>(
    Object.entries({
      bold: state?.bold,
      italic: state?.italic,
      blockquote: state?.blockquote,
      bulletList: state?.bulletList,
      orderedList: state?.orderedList,
    })
      .filter(([, active]) => active)
      .map(([key]) => key),
  );

  function onFormatSelectionChange(keys: Set<Key>) {
    if (!editor) return;
    for (const key of Object.keys(FORMAT_COMMANDS)) {
      if (selectedKeys.has(key) !== keys.has(key)) FORMAT_COMMANDS[key](editor);
    }
  }

  function openLinkRow() {
    if (!editor) return;
    setLinkDraft(state?.link ? state.linkHref : "");
    setLinkRowOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const href = normalizeLinkHref(linkDraft);
    if (!href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkRowOpen(false);
  }

  function removeLink() {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkDraft("");
    setLinkRowOpen(false);
  }

  return (
    <div className="review-note-editor" data-invalid={isInvalid || undefined}>
      <div className="review-note-toolbar">
        <ToggleButtonGroup
          aria-label="补充说明格式"
          selectedKeys={selectedKeys}
          selectionMode="multiple"
          size="sm"
          onSelectionChange={(keys) => onFormatSelectionChange(keys as Set<Key>)}
        >
          <ToggleButton aria-label="加粗" id="bold">
            <span aria-hidden className="font-bold">B</span>
          </ToggleButton>
          <ToggleButton aria-label="斜体" id="italic">
            <ToggleButtonGroup.Separator />
            <span aria-hidden className="italic">I</span>
          </ToggleButton>
          <ToggleButton aria-label="引用" id="blockquote">
            <ToggleButtonGroup.Separator />
            引用
          </ToggleButton>
          <ToggleButton aria-label="无序列表" id="bulletList">
            <ToggleButtonGroup.Separator />
            无序列表
          </ToggleButton>
          <ToggleButton aria-label="有序列表" id="orderedList">
            <ToggleButtonGroup.Separator />
            有序列表
          </ToggleButton>
        </ToggleButtonGroup>
        <Button
          aria-label="链接"
          size="sm"
          variant="tertiary"
          onPress={openLinkRow}
        >
          链接
        </Button>
      </div>
      {linkRowOpen ? (
        <div className="review-note-link-row">
          <Input
            aria-label="链接地址"
            className="flex-1"
            placeholder="https://example.com"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          <Button size="sm" onPress={applyLink}>
            应用链接
          </Button>
          {state?.link ? (
            <Button size="sm" variant="danger-soft" onPress={removeLink}>
              移除链接
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setLinkRowOpen(false)}
          >
            取消
          </Button>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
