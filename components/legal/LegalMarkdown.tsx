import Link from "next/link";
import type { ReactNode } from "react";

import { LEGAL_ROUTES } from "@/lib/legal/constants";

const POLICY_LINK_TARGETS: ReadonlyArray<{
  label: string;
  href: string;
}> = [
  {
    label: "Cookies and Similar Technologies Policy",
    href: LEGAL_ROUTES.cookies,
  },
  {
    label: "Cookies & Similar Technologies Policy",
    href: LEGAL_ROUTES.cookies,
  },
  {
    label: "Data Protection & Platform Terms",
    href: LEGAL_ROUTES.dataProtection,
  },
  {
    label: "Keynetic Data Protection & Platform Terms",
    href: LEGAL_ROUTES.dataProtection,
  },
  {
    label: "Privacy Policy",
    href: LEGAL_ROUTES.privacy,
  },
  {
    label: "Terms of Service",
    href: LEGAL_ROUTES.terms,
  },
];

function unescapeMarkdownBrackets(value: string): string {
  return value.replace(/\\([\[\]])/g, "$1");
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const source = unescapeMarkdownBrackets(text);
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...linkifyPlainText(
          source.slice(lastIndex, match.index),
          `${keyPrefix}-t${partIndex++}`
        )
      );
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      const inner = token.slice(2, -2);
      const linked = linkifyKnownPolicy(inner);

      if (linked) {
        nodes.push(
          <Link
            key={`${keyPrefix}-b${partIndex++}`}
            href={linked.href}
            className="font-semibold text-slate-900 underline underline-offset-2 hover:text-brand-primary"
          >
            {linked.label}
          </Link>
        );
      } else {
        nodes.push(
          <strong
            key={`${keyPrefix}-b${partIndex++}`}
            className="font-semibold text-slate-900"
          >
            {inner}
          </strong>
        );
      }
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${partIndex++}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-800"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < source.length) {
    nodes.push(
      ...linkifyPlainText(
        source.slice(lastIndex),
        `${keyPrefix}-t${partIndex++}`
      )
    );
  }

  return nodes;
}

function linkifyKnownPolicy(
  label: string
): { label: string; href: string } | null {
  const match = POLICY_LINK_TARGETS.find((item) => item.label === label);
  return match ?? null;
}

function linkifyPlainText(text: string, keyPrefix: string): ReactNode[] {
  if (!text) {
    return [];
  }

  const sorted = [...POLICY_LINK_TARGETS].sort(
    (a, b) => b.label.length - a.label.length
  );
  const pattern = new RegExp(
    `(${sorted
      .map((item) => item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "g"
  );

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const label = match[0];
    const target = linkifyKnownPolicy(label);

    if (target) {
      nodes.push(
        <Link
          key={`${keyPrefix}-l${partIndex++}`}
          href={target.href}
          className="font-medium text-slate-900 underline underline-offset-2 hover:text-brand-primary"
        >
          {target.label}
        </Link>
      );
    } else {
      nodes.push(label);
    }

    lastIndex = match.index + label.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isHeading(line: string): RegExpMatchArray | null {
  return /^(#{1,3})\s+(.*)$/.exec(line);
}

function isBullet(line: string): boolean {
  return /^\*\s+/.test(line);
}

function stripHeadingMarkers(headingText: string): string {
  return unescapeMarkdownBrackets(
    headingText.replace(/^\*\*/, "").replace(/\*\*$/, "").trim()
  );
}

type LegalMarkdownProps = {
  markdown: string;
};

export function LegalMarkdown({ markdown }: LegalMarkdownProps) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockIndex = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(
        <hr
          key={`hr-${blockIndex++}`}
          className="my-10 border-slate-200"
        />
      );
      index += 1;
      continue;
    }

    const heading = isHeading(line);

    if (heading) {
      const level = heading[1].length;
      const text = stripHeadingMarkers(heading[2] ?? "");
      const className =
        level === 1
          ? "text-3xl md:text-4xl font-bold text-slate-900"
          : level === 2
            ? "mt-10 text-xl font-bold text-slate-900 scroll-mt-8"
            : "mt-8 text-lg font-semibold text-slate-900 scroll-mt-8";

      if (level === 1) {
        blocks.push(
          <h1 key={`h-${blockIndex++}`} className={className}>
            {text}
          </h1>
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={`h-${blockIndex++}`} className={className}>
            {text}
          </h2>
        );
      } else {
        blocks.push(
          <h3 key={`h-${blockIndex++}`} className={className}>
            {text}
          </h3>
        );
      }

      index += 1;
      continue;
    }

    if (isBullet(line)) {
      const items: string[] = [];

      while (index < lines.length && isBullet(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\*\s+/, "").trim());
        index += 1;
      }

      blocks.push(
        <ul
          key={`ul-${blockIndex++}`}
          className="mt-4 list-disc space-y-2 pl-5 text-slate-700 leading-relaxed"
        >
          {items.map((item, itemIndex) => (
            <li key={`li-${blockIndex}-${itemIndex}`}>
              {renderInline(item, `li-${blockIndex}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const paragraphLines: string[] = [];

    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      (lines[index] ?? "").trim() !== "---" &&
      !isHeading(lines[index] ?? "") &&
      !isBullet(lines[index] ?? "")
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }

    const paragraph = paragraphLines.join(" ");

    blocks.push(
      <p
        key={`p-${blockIndex++}`}
        className="mt-4 text-slate-700 leading-relaxed"
      >
        {renderInline(paragraph, `p-${blockIndex}`)}
      </p>
    );
  }

  return <article className="legal-markdown">{blocks}</article>;
}
