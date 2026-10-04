import { memo, type ReactNode } from "react";

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

const RULE_PATTERN = /^([-*_])(\s*\1){2,}$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const QUOTE_PATTERN = /^>\s?(.*)$/;
const BULLET_PATTERN = /^[-*•]\s+(.+)$/;
const ORDERED_PATTERN = /^[0-9۰-۹]+[.)]\s+(.+)$/;
const TABLE_SEPARATOR_PATTERN =
  /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/;
const EMPTY_CELL_PATTERN = /^[-–—\s]*$/;
const NUMBER_CELL_PATTERN = /^[0-9۰-۹]+[.)]?$/;
const SECTION_PATTERN =
  /^(روز|هفته|جلسه|مرحله|day|week|session|step)\s*([0-9۰-۹]+)\s*(?:[—–:|\-]\s*(.+))?$/i;
const SHORT_CELL_LIMIT = 24;
const INDEX_HEADERS: readonly string[] = ["#", "ردیف", "شماره", "no", "no."];

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

function hasIndexColumn(block: TableBlock): boolean {
  const first = (block.header[0] ?? "").trim().toLowerCase();

  if (INDEX_HEADERS.includes(first)) {
    return true;
  }

  return (
    block.rows.length > 0 &&
    block.rows.every((row) => NUMBER_CELL_PATTERN.test((row[0] ?? "").trim()))
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

function renderTable(block: TableBlock, key: string): ReactNode {
  const direction = detectDirection([...block.header, ...block.rows.flat()]);
  const rtl = direction === "rtl";
  const indexed = hasIndexColumn(block);
  const titleIndex = indexed ? 1 : 0;
  const restStart = titleIndex + 1;

  return (
    <div key={key} dir={direction} className="w-full">
      <div className="flex flex-col gap-3 sm:hidden">
        {block.rows.map((row, rowIndex) => {
          const badgeSource = indexed
            ? (row[0] ?? "").replace(/[.)]$/, "")
            : String(rowIndex + 1);
          const badge = rtl ? toPersianDigits(badgeSource) : badgeSource;
          const rawTitle = row[titleIndex] ?? "";
          const title = EMPTY_CELL_PATTERN.test(rawTitle) ? "•" : rawTitle;
          const cells = row
            .slice(restStart)
            .map((cell, cellIndex) => ({
              cell,
              label: block.header[restStart + cellIndex] ?? "",
              cellIndex,
            }))
            .filter((entry) => !EMPTY_CELL_PATTERN.test(entry.cell));
          const chips = cells.filter(
            (entry) => entry.cell.length <= SHORT_CELL_LIMIT,
          );
          const notes = cells.filter(
            (entry) => entry.cell.length > SHORT_CELL_LIMIT,
          );

          return (
            <div
              key={`${key}-m${rowIndex}`}
              className="rounded-2xl border border-[rgba(57,255,136,0.18)] bg-[rgba(57,255,136,0.04)] p-3"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(57,255,136,0.16)] text-xs font-bold tabular-nums text-primary">
                  {badge}
                </span>
                <div className="min-w-0 flex-1 pt-0.5 text-[15px] font-semibold leading-6 text-text">
                  {renderInline(title, `${key}-m${rowIndex}t`, rtl)}
                </div>
              </div>

              {chips.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {chips.map((entry) => (
                    <div
                      key={`${key}-m${rowIndex}c${entry.cellIndex}`}
                      className="min-w-[4.5rem] rounded-xl bg-white/[0.05] px-3 py-1.5"
                    >
                      <div className="text-[10px] leading-4 text-text-subtle">
                        {renderInline(
                          entry.label,
                          `${key}-m${rowIndex}l${entry.cellIndex}`,
                          rtl,
                        )}
                      </div>
                      <div className="text-sm font-semibold leading-5 text-text">
                        {renderInline(
                          entry.cell,
                          `${key}-m${rowIndex}v${entry.cellIndex}`,
                          rtl,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {notes.map((entry) => (
                <div
                  key={`${key}-m${rowIndex}n${entry.cellIndex}`}
                  className="mt-2 text-sm leading-6 text-text-subtle"
                >
                  <span className="text-text-subtle">
                    {renderInline(
                      entry.label,
                      `${key}-m${rowIndex}nl${entry.cellIndex}`,
                      rtl,
                    )}
                    :{" "}
                  </span>
                  <span className="text-text">
                    {renderInline(
                      entry.cell,
                      `${key}-m${rowIndex}nv${entry.cellIndex}`,
                      rtl,
                    )}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="hidden w-full overflow-hidden rounded-2xl border border-[rgba(57,255,136,0.2)] sm:block">
        <table
          style={{ direction }}
          className="w-full border-collapse text-sm leading-6"
        >
          <thead>
            <tr className="bg-[rgba(57,255,136,0.08)]">
              {!indexed && (
                <th
                  style={{ textAlign: "start" }}
                  className="w-12 px-4 py-2.5 font-semibold text-primary"
                >
                  #
                </th>
              )}
              {block.header.map((cell, cellIndex) => (
                <th
                  key={`${key}-h${cellIndex}`}
                  style={{ textAlign: "start" }}
                  className="px-4 py-2.5 font-semibold text-primary"
                >
                  {renderInline(cell, `${key}-h${cellIndex}`, rtl)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${key}-r${rowIndex}`} className="even:bg-white/[0.03]">
                {!indexed && (
                  <td className="border-t border-white/5 px-4 py-2.5 align-top font-semibold tabular-nums text-primary">
                    {rtl ? toPersianDigits(String(rowIndex + 1)) : rowIndex + 1}
                  </td>
                )}
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${key}-r${rowIndex}c${cellIndex}`}
                    style={{ textAlign: "start" }}
                    className={`break-words border-t border-white/5 px-4 py-2.5 align-top ${
                      cellIndex === titleIndex ? "font-semibold text-text" : ""
                    }`}
                  >
                    {renderInline(cell, `${key}-r${rowIndex}c${cellIndex}`, rtl)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
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
        <pre
          key={key}
          dir="ltr"
          className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-left text-xs leading-6"
        >
          <code>{block.code}</code>
        </pre>
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
