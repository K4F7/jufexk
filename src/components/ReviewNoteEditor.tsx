import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

export type ReviewNoteValue = {
  /** Tiptap 默认输出的 HTML；空文档为空串。 */
  html: string;
  /** 去标签后的纯文本（块间换行），用于 10–1200 字门槛。 */
  text: string;
};

/**
 * 详细评价编辑器：沿用既有 Tiptap 白名单子集，不带格式工具栏、
 * 占位提纲或预览。仓库里没有独立的讨论 Markdown 编辑器可复用。
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

  if (!editor) return null;

  return (
    <div className="review-note-editor" data-invalid={isInvalid || undefined}>
      <EditorContent editor={editor} />
    </div>
  );
}
