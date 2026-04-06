"use client";

import Link from "next/link";
import { FaFileAlt, FaDownload, FaCalendarAlt, FaFolderOpen } from "react-icons/fa";
import BodyContentImage from "@/components/shared/BodyContentImage";
import RichMarkdown from "@/components/shared/RichMarkdown";
import { useTranslations } from "next-intl";

export default function ResultDetailClient({ result }) {
  const t = useTranslations("research.resultDetails");

  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t("notFound")}</h2>
          <Link href="/research/results" className="mt-4 inline-block text-blue-600 hover:underline">
            {t("backToResults")}
          </Link>
        </div>
      </div>
    );
  }

  const { title, description, publishedDate, projects = [], attachments = [], body = [] } = result;
  
  const markdownClassName = 'prose dark:prose-invert max-w-none text-gray-700 dark:text-gray-300';

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const getFileIcon = (mime) => {
    if (mime?.includes('image')) return '🖼️';
    if (mime?.includes('video')) return '🎥';
    if (mime?.includes('audio')) return '🎵';
    if (mime?.includes('pdf')) return '📄';
    return '📎';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-slate-50 dark:from-gray-950 dark:via-gray-950 dark:to-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <div className="mb-6">
          <Link
            href="/research/results"
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← {t("backToResults")}
          </Link>
        </div>

        {/* Main Content Card */}
        <div className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-gray-950/80 shadow-xl p-8 md:p-10">
          {/* Header Section */}
          <div className="border-b border-gray-200 dark:border-gray-800 pb-6 mb-6">
            <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-white leading-tight">
              {title}
            </h1>

            {/* Meta Info */}
            <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600 dark:text-gray-400">
              {publishedDate && (
                <div className="flex items-center gap-2">
                  <FaCalendarAlt className="w-4 h-4" />
                  <span>{new Date(publishedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              )}
              {attachments.length > 0 && (
                <div className="flex items-center gap-2">
                  <FaFileAlt className="w-4 h-4" />
                  <span>{attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}</span>
                </div>
              )}
            </div>

            {/* Description */}
            {description && (
              <p className="mt-4 text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
                {description}
              </p>
            )}
          </div>

          {/* Body Content (Dynamic Zone) */}
          {body && body.length > 0 && (
            <div className="mb-8 space-y-6">
              {body.map((block, index) => {
                if (!block || typeof block !== 'object') return null;

                if (block.__component === 'shared.rich-text') {
                  return (
                    <div key={`rich-${index}`}>
                      <RichMarkdown content={block.body} className={markdownClassName} />
                    </div>
                  );
                }

                if (block.__component === 'shared.section') {
                  return (
                    <article key={`section-${index}`} className="space-y-4">
                      {block.heading && (
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                          {block.heading}
                        </h2>
                      )}
                      {block.subheading && (
                        <p className="text-lg text-gray-500 dark:text-gray-400">
                          {block.subheading}
                        </p>
                      )}
                      {block.body && (
                        <RichMarkdown content={block.body} className={markdownClassName} />
                      )}
                      {block.media && (
                        <div className="mt-6 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                          <BodyContentImage
                            src={block.media}
                            alt={block.heading || title}
                            className="w-full"
                            portraitClassName="mx-auto w-auto max-w-full max-h-[60vh] object-contain"
                            landscapeClassName="w-full max-h-[36rem] object-cover"
                          />
                        </div>
                      )}
                    </article>
                  );
                }

                if (block.__component === 'shared.media' && block.file) {
                  return (
                    <figure key={`media-${index}`} className="rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                      <BodyContentImage
                        src={block.file}
                        alt={title}
                        className="w-full"
                        portraitClassName="mx-auto w-auto max-w-full max-h-[60vh] object-contain"
                        landscapeClassName="w-full max-h-[40rem] object-contain"
                      />
                    </figure>
                  );
                }

                if (block.__component === 'shared.slider' && Array.isArray(block.files) && block.files.length > 0) {
                  return (
                    <div key={`slider-${index}`} className="grid gap-4 sm:grid-cols-2">
                      {block.files.map((file, fileIndex) => (
                        <figure key={`slider-file-${index}-${fileIndex}`} className="rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900">
                          <BodyContentImage
                            src={file}
                            alt={`${title} media ${fileIndex + 1}`}
                            landscapeClassName="aspect-video w-full object-cover"
                            portraitClassName="mx-auto w-auto max-w-full max-h-[60vh] object-contain"
                          />
                        </figure>
                      ))}
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}

          {/* Attachments Section */}
          {attachments.length > 0 && (
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <FaFolderOpen className="w-6 h-6" />
                {t("attachments")}
              </h2>
              <div className="grid gap-3">
                {attachments.map((file, idx) => (
                  <a
                    key={idx}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition group"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-2xl flex-shrink-0">{getFileIcon(file.mime)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {file.name}
                        </div>
                        {(file.size || file.ext) && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {file.ext?.toUpperCase().replace('.', '')}
                            {file.size && ` • ${formatFileSize(file.size)}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <FaDownload className="w-5 h-5 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex-shrink-0 ml-3" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Related Projects */}
          {projects.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                {t("relatedProjects")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/research/projects/${project.slug}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition"
                  >
                    <span className="font-medium text-gray-900 dark:text-white">{project.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
