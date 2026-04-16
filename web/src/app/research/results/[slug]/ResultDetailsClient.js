'use client';

import Link from 'next/link';
import { FaArrowLeft, FaDownload, FaCalendarAlt, FaFolderOpen } from 'react-icons/fa';
import { useTranslations } from 'next-intl';
import BodyContentImage from '@/components/shared/BodyContentImage';
import RichMarkdown from '@/components/shared/RichMarkdown';

export default function ResultDetailsClient({ result }) {
  const t = useTranslations('research.resultDetails');
  const projects = Array.isArray(result?.projects) ? result.projects : [];
  const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
  const bodyBlocks = Array.isArray(result?.body) ? result.body : [];
  const markdownClassName = 'prose prose-lg prose-blue dark:prose-invert max-w-none text-gray-700 dark:text-gray-300';

  // Determine the "back" link - if there's exactly one project, go to it; otherwise go to projects list
  const backHref = projects.length === 1 && projects[0].slug 
    ? `/research/projects/${encodeURIComponent(projects[0].slug)}?tab=results`
    : '/research/projects';
  const backLabel = projects.length === 1 && projects[0].title
    ? projects[0].title
    : t('backToProjects');

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
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 pt-16 pb-20">
        
        {/* Breadcrumb */}
        <div className="mb-10 lg:mb-16">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white transition-colors"
          >
            <FaArrowLeft className="w-4 h-4" />
            {backLabel}
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 xl:gap-24">
          
          {/* LEFT COLUMN: METADATA */}
          <aside className="lg:col-span-4 flex flex-col gap-8">
            <div className="sticky top-24">
              {/* Title */}
              <div className="space-y-4 mb-8">
                <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 dark:text-white leading-[1.1]">
                  {result.title}
                </h1>
                
                {result.publishedDate && (
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 font-medium">
                    <FaCalendarAlt className="w-4 h-4" />
                    <span>
                      {new Date(result.publishedDate).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                )}
              </div>

              <div className="w-full h-px bg-gray-100 dark:bg-gray-800 my-8" />

              {/* Description */}
              {result.description && (
                <div className="text-gray-600 dark:text-gray-400 leading-relaxed mb-8">
                  <p>{result.description}</p>
                </div>
              )}

              {/* Attachments Summary */}
              {attachments.length > 0 && (
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <FaFolderOpen className="w-4 h-4" />
                    <span>
                      {attachments.length} {attachments.length === 1 ? t('attachment') : t('attachments')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT COLUMN: MAIN CONTENT */}
          <main className="lg:col-span-8 flex flex-col gap-16 xl:gap-24">
            
            {/* Dynamic Content Blocks */}
            {bodyBlocks.length > 0 && (
              <section className="space-y-12">
                {bodyBlocks.map((block, index) => {
                  if (!block || typeof block !== 'object') return null;

                  if (block.__component === 'shared.rich-text') {
                    return (
                      <div key={`rich-${index}`} className="prose-wrapper">
                        <RichMarkdown content={block.body} className={markdownClassName} />
                      </div>
                    );
                  }

                  if (block.__component === 'shared.section') {
                    return (
                      <article key={`section-${index}`} className="space-y-6">
                        <header>
                          {block.heading && <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">{block.heading}</h3>}
                          {block.subheading && <p className="text-lg text-gray-500 dark:text-gray-400">{block.subheading}</p>}
                        </header>
                        
                        <RichMarkdown content={block.body} className={markdownClassName} />
                        
                        {block.media?.url && (
                          <div className="mt-8 rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                            <BodyContentImage
                              src={block.media.url}
                              alt={block.media.alt || block.heading || result.title}
                              className="w-full"
                              portraitClassName="mx-auto w-auto max-w-full max-h-[60vh] object-contain"
                              landscapeClassName="w-full max-h-[36rem] object-cover"
                            />
                          </div>
                        )}
                      </article>
                    );
                  }

                  if (block.__component === 'shared.media' && block.file?.url) {
                    return (
                      <figure key={`media-${index}`} className="rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-4">
                        <BodyContentImage
                          src={block.file.url}
                          alt={block.file.alt || result.title}
                          className="rounded-xl"
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
                          <figure key={`slider-file-${index}-${fileIndex}`} className="rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-900">
                            <BodyContentImage
                              src={file.url}
                              alt={file.alt || `${result.title} media ${fileIndex + 1}`}
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
              </section>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <section className="pt-10 border-t border-gray-100 dark:border-gray-800">
                <header className="mb-8">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                    {t('attachments')}
                  </h2>
                  <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Download files and resources related to this result
                  </p>
                </header>

                <div className="flex flex-col gap-3">
                  {attachments.map((file, idx) => (
                    <a
                      key={idx}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-4 py-5 px-6 rounded-2xl bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className="text-2xl flex-shrink-0">{getFileIcon(file.mime)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {file.name}
                          </div>
                          {(file.size || file.ext) && (
                            <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                              {file.ext?.toUpperCase().replace('.', '')}
                              {file.size && ` • ${formatFileSize(file.size)}`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white dark:bg-black border border-gray-200 dark:border-gray-700 shadow-sm text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all">
                          <FaDownload className="w-4 h-4" />
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

          </main>
        </div>
      </div>
    </div>
  );
}
