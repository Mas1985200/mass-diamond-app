import { memo, type ReactNode } from "react";

interface MarkdownTextProps {
  readonly text: string;
}

type Block =
  | { readonly kind: "paragraph"; readonly text: string }
  | {
      readonly kind: "heading";
      readonly level: 1 | 2 | 3;
      readonly text: string;
    }
  | { readonly kind: "code"; readonly code: string }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly string[];
    }
  | { readonly kind: "quote"; readonly text: string }
  | { readonly kind: "rule" };

const RULE_PATTERN = /^([-*_])(\s*\1){2,}$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const QUOTE_PATTERN = /^>\s?(.*)$/;
const BULLET_PATTERN = /^[-*•]\s+(.+)$/;
const ORDERED_PATTERN = /^[0-9۰-۹]+[.)]\s+(.+)$/;

const INLINE_SOURCE =
  "(`[^`\\n]+`)|(\\*\\*[^*\\n]+?\\*\\*)|(\\*[^*\\s][^*\\n]*?\\*)|(\\[[^\\]\\n]+\\]\\((https?:\\/\\/[^\\s)]+)\\))";

function isBlockStart(trimmed: string): boolean {
  return (
    trimmed.startsWith("```") ||
    RULE_PATTERN.test(trimmed) ||
    HEADING_PATTERN.test(trimmed) ||
    QUOTE_PATTERN.test(trimmed) ||
    BULLET_PATTERN.test(trimmed) ||
    ORDERED_PATTERN.test(trimmed)
  );
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;

      while (
        index < lines.length &&
        !(lines[index] ?? "").trim().startsWith("```")
      ) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      index += 1;
      blocks.push({ kind: "code", code: codeLines.join("\n") });
      continue;
    }

    if (RULE_PATTERN.test(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING_PATTERN.exec(trimmed);

    if (heading) {
      const hashes = heading[1] ?? "#";
      const level = Math.min(hashes.length, 3) as 1 | 2 | 3;

      blocks.push({ kind: "heading", level, text: heading[2] ?? "" });
      index += 1;
      continue;
    }

    if (QUOTE_PATTERN.test(trimmed)) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const quoteMatch = QUOTE_PATTERN.exec((lines[index] ?? "").trim());

        if (!quoteMatch) {
          break;
        }

        quoteLines.push(quoteMatch[1] ?? "");
        index += 1;
      }

      blocks.push({ kind: "quote", text: quoteLines.join("\n") });
      continue;
    }

    const ordered = ORDERED_PATTERN.test(trimmed);

    if (ordered || BULLET_PATTERN.test(trimmed)) {
      const pattern = ordered ? ORDERED_PATTERN : BULLET_PATTERN;
      const items: string[] = [];

      while (index < lines.length) {
        const itemMatch = pattern.exec((lines[index] ?? "").trim());

        if (!itemMatch) {
          break;
        }

        items.push(itemMatch[1] ?? "");
        index += 1;
      }

      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();

      if (current === "" || isBlockStart(current)) {
        break;
      }

      paragraphLines.push(current);
      index += 1;
    }

    if (paragraphLines.length === 0) {
      paragraphLines.push(trimmed);
      index += 1;
    }

    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_SOURCE, "g");
  let lastIndex = 0;
  let counter = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${counter}`;
    counter += 1;

    const code = match[1];
    const bold = match[2];
    const italic = match[3];
    const link = match[4];
    const url = match[5];

    if (code !== undefined) {
      nodes.push(
        <code
          key={key}
          dir="ltr"
          className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em]"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-text">
          {renderInline(bold.slice(2, -2), key)}
        </strong>,
      );
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{renderInline(italic.slice(1, -1), key)}</em>);
    } else if (link !== undefined && url !== undefined) {
      const label = link.slice(1, link.indexOf("]("));

      nodes.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline underline-offset-2"
        >
          {label}
        </a>,
      );
    } else {
      nodes.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return (
        <p key={key} dir="auto" className="whitespace-pre-line break-words">
          {renderInline(block.text, key)}
        </p>
      );

    case "heading":
      return (
        <p
          key={key}
          dir="auto"
          className={`font-semibold text-text break-words ${
            block.level === 1 ? "text-lg" : "text-base"
          }`}
        >
          {renderInline(block.text, key)}
        </p>
      );

    case "code":
      return (
        <pre
          key={key}
          dir="ltr"
          className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-left text-xs leading-6"
        >
          <code>{block.code}</code>
        </pre>
      );

    case "list": {
      const items = block.items.map((item, itemIndex) => (
        <li key={`${key}-i${itemIndex}`} className="break-words">
          {renderInline(item, `${key}-i${itemIndex}`)}
        </li>
      ));

      return block.ordered ? (
        <ol key={key} dir="auto" className="list-decimal space-y-1.5 px-5">
          {items}
        </ol>
      ) : (
        <ul key={key} dir="auto" className="list-disc space-y-1.5 px-5">
          {items}
        </ul>
      );
    }

    case "quote":
      return (
        <blockquote
          key={key}
          dir="auto"
          className="whitespace-pre-line rounded-lg bg-white/5 px-3 py-2 text-text-subtle"
        >
          {renderInline(block.text, key)}
        </blockquote>
      );

    case "rule":
      return <hr key={key} className="border-white/10" />;
  }
}

function MarkdownText({ text }: MarkdownTextProps) {
  const blocks = parseBlocks(text);

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, blockIndex) => renderBlock(block, `b${blockIndex}`))}
    </div>
  );
}

export default memo(MarkdownText);
