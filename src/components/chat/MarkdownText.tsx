import { memo, useEffect, useRef, useState, type ReactNode } from "react";

interface MarkdownTextProps {
  readonly text: string;
}

type TableBlock = {
  readonly kind: "table";
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

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
  | TableBlock
  | { readonly kind: "rule" };

interface SectionInfo {
  readonly label: string;
  readonly number: string;
  readonly title: string;
}

interface CopyLabels {
  readonly idle: string;
  readonly done: string;
  readonly failed: string;
}

interface TableLayout {
  readonly grouped: boolean;
  readonly visible: readonly number[];
  readonly noteColumn: number | null;
}

interface RowGroup {
  readonly title: string | null;
  readonly rows: readonly (readonly string[])[];
}

const RULE_PATTERN = /^([-*_])(\s*\1){2,}$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const QUOTE_PATTERN = /^>\s?(.*)$/;
const BULLET_PATTERN = /^[-*•]\s+(.+)$/;
const ORDERED_PATTERN = /^[0-9۰-۹]+[.)]\s+(.+)$/;
const TABLE_SEPARATOR_PATTERN =
  /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/;
const EMPTY_CELL_PATTERN = /^[-–—\s]*$/;
const SECTION_PATTERN =
  /^(روز|هفته|جلسه|مرحله|day|week|session|step)\s*([0-9۰-۹]+)\s*(?:[—–:|\-]\s*(.+))?$/i;
const GROUP_VALUE_PATTERN =
  /^(روز|هفته|جلسه|مرحله|day|week|session|step)\s*[0-9۰-۹]+/i;
const NOTE_HEADER_PATTERN =
  /^(نکته|نکات|توضیح|توضیحات|یادداشت|note|notes|description|comment|comments)$/i;
const SHORT_CELL_LIMIT = 14;
const COPY_RESET_MS = 1800;

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

const INLINE_SOURCE =
  "(`[^`\\n]+`)|(\\*\\*[^*\\n]+?\\*\\*)|(\\*[^*\\s][^*\\n]*?\\*)|(\\[[^\\]\\n]+\\]\\((https?:\\/\\/[^\\s)]+)\\))";

function toPersianDigits(text: string): string {
  return text.replace(/\S+/g, (token) =>
    /[A-Za-z]/.test(token)
      ? token
      : token.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit),
  );
}

function detectDirection(texts: readonly string[]): "rtl" | "ltr" {
  for (const text of texts) {
    for (const char of text) {
      if (RTL_CHAR.test(char)) {
        return "rtl";
      }

      if (LTR_CHAR.test(char)) {
        return "ltr";
      }
    }
  }

  return "rtl";
}

function matchSection(text: string): SectionInfo | null {
  const plain = text.replace(/\*/g, "").replace(/\s+/g, " ").trim();

  if (plain.length === 0 || plain.length > 90) {
    return null;
  }

  const match = SECTION_PATTERN.exec(plain);

  if (!match) {
    return null;
  }

  return {
    label: match[1] ?? "",
    number: match[2] ?? "",
    title: (match[3] ?? "").trim(),
  };
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const current = (lines[index] ?? "").trim();
  const next = (lines[index + 1] ?? "").trim();

  return (
    current.includes("|") &&
    next.includes("|") &&
    TABLE_SEPARATOR_PATTERN.test(next)
  );
}

function splitTableRow(line: string): string[] {
  let body = line.trim();

  if (body.startsWith("|")) {
    body = body.slice(1);
  }

  if (body.endsWith("|")) {
    body = body.slice(0, -1);
  }

  return body.split("|").map((cell) => cell.trim());
}

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

    if (isTableStart(lines, index)) {
      const header = splitTableRow(trimmed);
      const columns = header.length;
      const rows: string[][] = [];

      index += 2;

      while (index < lines.length) {
        const rowLine = (lines[index] ?? "").trim();

        if (rowLine === "" || !rowLine.includes("|")) {
          break;
        }

        const cells = splitTableRow(rowLine);

        while (cells.length < columns) {
          cells.push("");
        }

        rows.push(cells.slice(0, columns));
        index += 1;
      }

      blocks.push({ kind: "table", header, rows });
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

      if (
        current === "" ||
        isBlockStart(current) ||
        (paragraphLines.length > 0 && isTableStart(lines, index))
      ) {
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

function renderInline(
  text: string,
  keyPrefix: string,
  rtl: boolean,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_SOURCE, "g");
  const plain = (value: string): string =>
    rtl ? toPersianDigits(value) : value;
  let lastIndex = 0;
  let counter = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(plain(text.slice(lastIndex, match.index)));
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
          {renderInline(bold.slice(2, -2), key, rtl)}
        </strong>,
      );
    } else if (italic !== undefined) {
      nodes.push(
        <em key={key}>{renderInline(italic.slice(1, -1), key, rtl)}</em>,
      );
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
          {plain(label)}
        </a>,
      );
    } else {
      nodes.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(plain(text.slice(lastIndex)));
  }

  return nodes;
}

function plainText(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/\*([^*\s][^*\n]*?)\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function tableToTsv(block: TableBlock): string {
  const clean = (cell: string): string =>
    plainText(cell).replace(/[\t\r\n]+/g, " ");

  return [block.header, ...block.rows]
    .map((row) => row.map(clean).join("\t"))
    .join("\n");
}

function copyLabels(rtl: boolean, kind: "table" | "code"): CopyLabels {
  if (rtl) {
    return {
      idle: kind === "table" ? "کپی جدول" : "کپی کد",
      done: "کپی شد ✓",
      failed: "کپی نشد",
    };
  }

  return {
    idle: kind === "table" ? "Copy table" : "Copy code",
    done: "Copied ✓",
    failed: "Copy failed",
  };
}

function pageIsRtl(): boolean {
  return (
    typeof document !== "undefined" && document.documentElement.dir === "rtl"
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    // Fall back to the legacy approach below.
  }

  try {
    const area = document.createElement("textarea");

    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);

    const copied = document.execCommand("copy");

    document.body.removeChild(area);

    return copied;
  } catch {
    return false;
  }
}

function CopyButton({
  text,
  labels,
}: {
  readonly text: string;
  readonly labels: CopyLabels;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async (): Promise<void> => {
    const copied = await copyToClipboard(text);

    setState(copied ? "done" : "failed");

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setState("idle");
    }, COPY_RESET_MS);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="rounded-full border border-[rgba(57,255,136,0.35)] px-3 py-1 text-xs text-primary transition-colors hover:bg-[rgba(57,255,136,0.08)]"
    >
      {state === "idle"
        ? labels.idle
        : state === "done"
          ? labels.done
          : labels.failed}
    </button>
  );
}

function renderSection(
  section: SectionInfo,
  direction: "rtl" | "ltr",
  key: string,
): ReactNode {
  const rtl = direction === "rtl";
  const number = rtl ? toPersianDigits(section.number) : section.number;

  return (
    <div key={key} dir={direction} className="mt-3 flex items-center gap-3">
      <span className="flex h-12 min-w-[3.4rem] shrink-0 flex-col items-center justify-center rounded-2xl border border-[rgba(57,255,136,0.35)] bg-[rgba(57,255,136,0.12)] px-2 leading-none text-primary">
        <span className="text-[10px] opacity-80">{section.label}</span>
        <span className="mt-1 text-lg font-bold tabular-nums">{number}</span>
      </span>
      {section.title && (
        <span className="min-w-0 flex-1 break-words text-base font-semibold leading-6 text-text">
          {renderInline(section.title, `${key}-s`, rtl)}
        </span>
      )}
    </div>
  );
}

function analyzeTable(block: TableBlock): TableLayout {
  const grouped =
    block.header.length >= 2 &&
    block.rows.length > 0 &&
    block.rows.every((row) => GROUP_VALUE_PATTERN.test(plainText(row[0] ?? "")));

  const start = grouped ? 1 : 0;
  const columns = Array.from(
    { length: Math.max(0, block.header.length - start) },
    (_, offset) => offset + start,
  );
  const lastColumn = columns[columns.length - 1];

  const noteColumn =
    columns.length >= 4 &&
    lastColumn !== undefined &&
    NOTE_HEADER_PATTERN.test(plainText(block.header[lastColumn] ?? ""))
      ? lastColumn
      : null;

  return {
    grouped,
    visible: noteColumn === null ? columns : columns.slice(0, -1),
    noteColumn,
  };
}

function groupRows(block: TableBlock, grouped: boolean): RowGroup[] {
  if (!grouped) {
    return [{ title: null, rows: block.rows }];
  }

  const groups: Array<{ title: string; rows: string[][] }> = [];

  for (const row of block.rows) {
    const title = plainText(row[0] ?? "");
    const last = groups[groups.length - 1];

    if (last && last.title === title) {
      last.rows.push([...row]);
    } else {
      groups.push({ title, rows: [[...row]] });
    }
  }

  return groups;
}

function renderTable(block: TableBlock, key: string): ReactNode {
  const direction = detectDirection([...block.header, ...block.rows.flat()]);
  const rtl = direction === "rtl";
  const layout = analyzeTable(block);
  const groups = groupRows(block, layout.grouped);
  const columnCount = layout.visible.length;

  return (
    <div key={key} dir={direction} className="w-full">
      <div className="mb-1.5 flex justify-end">
        <CopyButton text={tableToTsv(block)} labels={copyLabels(rtl, "table")} />
      </div>

      <div className="w-full overflow-x-auto rounded-2xl border border-[rgba(57,255,136,0.2)]">
        <table
          style={{ direction }}
          className="w-full border-collapse text-[13px] leading-5"
        >
          <thead>
            <tr className="bg-[rgba(57,255,136,0.08)]">
              {layout.visible.map((column, position) => (
                <th
                  key={`${key}-h${column}`}
                  style={{ textAlign: "start" }}
                  className={`px-2.5 py-2 text-xs font-semibold text-primary ${
                    position === 0 ? "min-w-[8.5rem]" : "whitespace-nowrap"
                  }`}
                >
                  {renderInline(
                    block.header[column] ?? "",
                    `${key}-h${column}`,
                    rtl,
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {groups.map((group, groupIndex) => (
            <tbody key={`${key}-g${groupIndex}`}>
              {group.title !== null && (
                <tr>
                  <td
                    colSpan={columnCount}
                    style={{ textAlign: "start" }}
                    className="border-t border-[rgba(57,255,136,0.2)] bg-[rgba(57,255,136,0.10)] px-3 py-2 text-sm font-bold text-primary"
                  >
                    {renderInline(group.title, `${key}-g${groupIndex}t`, rtl)}
                  </td>
                </tr>
              )}

              {group.rows.map((row, rowIndex) => (
                <tr
                  key={`${key}-g${groupIndex}r${rowIndex}`}
                  className="even:bg-white/[0.03]"
                >
                  {layout.visible.map((column, position) => {
                    const cell = row[column] ?? "";
                    const empty = EMPTY_CELL_PATTERN.test(cell);
                    const cellKey = `${key}-g${groupIndex}r${rowIndex}c${column}`;

                    if (position === 0) {
                      const note =
                        layout.noteColumn !== null
                          ? (row[layout.noteColumn] ?? "")
                          : "";
                      const hasNote = !EMPTY_CELL_PATTERN.test(note);
                      const badgeSource = String(rowIndex + 1);
                      const badge = rtl
                        ? toPersianDigits(badgeSource)
                        : badgeSource;

                      return (
                        <td
                          key={cellKey}
                          style={{ textAlign: "start" }}
                          className="min-w-[8.5rem] border-t border-white/5 px-2.5 py-2 align-top"
                        >
                          <div className="flex items-start gap-2">
                            {layout.grouped && (
                              <span className="mt-0.5 flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-[rgba(57,255,136,0.16)] px-1 text-[11px] font-bold tabular-nums text-primary">
                                {badge}
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="break-words font-semibold text-text">
                                {empty ? "•" : renderInline(cell, cellKey, rtl)}
                              </div>
                              {hasNote && (
                                <div className="mt-0.5 break-words text-[11px] leading-4 text-text-subtle">
                                  {renderInline(note, `${cellKey}n`, rtl)}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td
                        key={cellKey}
                        style={{ textAlign: "start" }}
                        className={`border-t border-white/5 px-2.5 py-2 align-top ${
                          cell.length <= SHORT_CELL_LIMIT
                            ? "whitespace-nowrap"
                            : "min-w-[6rem] break-words"
                        }`}
                      >
                        {empty ? (
                          <span className="text-text-subtle">–</span>
                        ) : (
                          renderInline(cell, cellKey, rtl)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case "paragraph": {
      const direction = detectDirection([block.text]);
      const section = matchSection(block.text);

      if (section) {
        return renderSection(section, direction, key);
      }

      return (
        <p
          key={key}
          dir={direction}
          className="whitespace-pre-line break-words"
        >
          {renderInline(block.text, key, direction === "rtl")}
        </p>
      );
    }

    case "heading": {
      const direction = detectDirection([block.text]);
      const section = matchSection(block.text);

      if (section) {
        return renderSection(section, direction, key);
      }

      return (
        <p
          key={key}
          dir={direction}
          className={`break-words ${
            block.level === 1
              ? "text-xl font-bold text-text"
              : block.level === 2
                ? "text-lg font-bold text-text"
                : "text-base font-semibold text-primary"
          }`}
        >
          {renderInline(block.text, key, direction === "rtl")}
        </p>
      );
    }

    case "code":
      return (
        <div key={key} dir="ltr" className="w-full">
          <div className="mb-1.5 flex justify-end">
            <CopyButton
              text={block.code}
              labels={copyLabels(pageIsRtl(), "code")}
            />
          </div>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-left text-xs leading-6">
            <code>{block.code}</code>
          </pre>
        </div>
      );

    case "list": {
      const direction = detectDirection(block.items);
      const rtl = direction === "rtl";
      const numberLocale = rtl ? "fa-IR" : "en-US";

      return (
        <div
          key={key}
          role="list"
          dir={direction}
          style={{ direction }}
          className="flex flex-col gap-1.5 px-1"
        >
          {block.items.map((item, itemIndex) => {
            const marker = block.ordered
              ? `${(itemIndex + 1).toLocaleString(numberLocale, {
                  useGrouping: false,
                })}.`
              : "•";

            return (
              <div
                key={`${key}-i${itemIndex}`}
                role="listitem"
                dir={direction}
                style={{ direction, textAlign: "start" }}
                className="flex items-start gap-2.5 leading-7"
              >
                <span
                  aria-hidden="true"
                  className="min-w-[1.1rem] shrink-0 select-none text-center text-text-subtle"
                >
                  {marker}
                </span>
                <span
                  dir={direction}
                  style={{ direction, textAlign: "start" }}
                  className="min-w-0 flex-1 break-words"
                >
                  {renderInline(item, `${key}-i${itemIndex}`, rtl)}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    case "table":
      return renderTable(block, key);

    case "quote": {
      const direction = detectDirection([block.text]);

      return (
        <blockquote
          key={key}
          dir={direction}
          className="whitespace-pre-line rounded-lg bg-white/5 px-3 py-2 text-text-subtle"
        >
          {renderInline(block.text, key, direction === "rtl")}
        </blockquote>
      );
    }

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
