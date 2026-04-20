'use client';

import { useMemo, useState } from 'react';
import RichMarkdown from '@/components/shared/RichMarkdown';

function toPlainText(markdown) {
  if (typeof markdown !== 'string') return '';

  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ExpandableMarkdown({
  content,
  previewLength = 180,
  expandLabel = 'Show more',
  collapseLabel = 'Show less',
  collapsedTextClassName = 'text-sm text-gray-600 dark:text-gray-400 leading-relaxed',
  markdownClassName = 'prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300',
  buttonClassName = 'text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors',
}) {
  const [expanded, setExpanded] = useState(false);

  const markdown = typeof content === 'string' ? content.trim() : '';
  const plainText = useMemo(() => toPlainText(markdown), [markdown]);

  if (!markdown) return null;

  const shouldCollapse = plainText.length > previewLength;
  const previewText = shouldCollapse
    ? `${plainText.slice(0, previewLength).trimEnd()}...`
    : plainText;

  if (!shouldCollapse) {
    return <RichMarkdown content={markdown} className={markdownClassName} />;
  }

  return (
    <div className="space-y-2">
      {expanded ? (
        <RichMarkdown content={markdown} className={markdownClassName} />
      ) : (
        <p className={collapsedTextClassName}>{previewText}</p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={buttonClassName}
        aria-expanded={expanded}
      >
        {expanded ? collapseLabel : expandLabel}
      </button>
    </div>
  );
}
