"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { FaSearch, FaTimes, FaFileAlt, FaCalendarAlt, FaFolderOpen } from "react-icons/fa";
import { containerVariants, itemVariants } from "@/lib/animations";
import { useTranslations } from "next-intl";

const normalizeSearchText = (value) =>
  (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const parseSearchTerms = (query) =>
  normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);

// TODO: Replace with react-icons if possible
const getFileIcon = (mime) => {
  if (mime?.includes('image')) return '🖼️';
  if (mime?.includes('video')) return '🎥';
  if (mime?.includes('audio')) return '🎵';
  if (mime?.includes('pdf')) return '📄';
  return '📎';
};

export default function ResultsClient({ results: rawResults = [] }) {
  const t = useTranslations("research.results");
  
  const [q, setQ] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const results = useMemo(() => {
    return Array.isArray(rawResults) ? rawResults.filter((r) => r.title) : [];
  }, [rawResults]);

  const projectOptions = useMemo(() => {
    const projects = new Set();
    for (const r of results) {
      r.projects?.forEach((p) => p?.title && projects.add(p.title));
    }
    return Array.from(projects).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filtered = useMemo(() => {
    const terms = parseSearchTerms(q);
    return results.filter((r) => {
      const projectTitles = r.projects?.map((p) => p?.title || "").join(" ") || "";
      const haystack = normalizeSearchText(
        [r.title, r.description, projectTitles].join(" ")
      );

      const matchesQ = !terms.length || terms.every((term) => haystack.includes(term));
      const matchesProject = !projectFilter || r.projects?.some((p) => p?.title === projectFilter);

      return matchesQ && matchesProject;
    });
  }, [results, q, projectFilter]);

  const hasActiveFilters = q || projectFilter;

  const clearFilters = () => {
    setQ("");
    setProjectFilter("");
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
      });
    } catch {
      return null;
    }
  };

  return (
    <div className="page-container">
      <div className="content-wrapper content-padding">
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <motion.div variants={itemVariants} className="page-header">
            <h1 className="page-header-title">{t("title")}</h1>
            <p className="page-header-subtitle">{t("subtitle")}</p>
          </motion.div>

          {/* Search and Filters */}
          <motion.div variants={itemVariants} className="mb-8">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              {/* Project Filter */}
              {projectOptions.length > 0 && (
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all min-w-[200px]"
                >
                  <option value="">{t("allProjects")}</option>
                  {projectOptions.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              )}

              {/* Clear Filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <FaTimes className="w-4 h-4" />
                  <span>{t("clearFilters")}</span>
                </button>
              )}
            </div>
          </motion.div>

          {/* Results Count */}
          <motion.div variants={itemVariants} className="mb-6">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {filtered.length === 1
                ? t("resultCount", { count: filtered.length })
                : t("resultCountPlural", { count: filtered.length })}
            </p>
          </motion.div>

          {/* Results Grid */}
          <AnimatePresence mode="wait">
            {filtered.length > 0 ? (
              <motion.div
                key="results-grid"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
              >
                {filtered.map((result) => (
                  <motion.div key={result.id || result.slug} variants={itemVariants}>
                    <Link href={`/research/results/${result.slug}`} className="block group h-full">
                      <div className="h-full bg-white dark:bg-gray-800 rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 p-6 flex flex-col border border-gray-100 dark:border-gray-700 group-hover:border-blue-200 dark:group-hover:border-blue-800">
                        {/* Title */}
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mb-3 line-clamp-2">
                          {result.title}
                        </h3>

                        {/* Description */}
                        {result.description && (
                          <p className="text-gray-600 dark:text-gray-300 text-sm line-clamp-3 mb-4 flex-1">
                            {result.description}
                          </p>
                        )}

                        {/* Meta */}
                        <div className="mt-auto space-y-2">
                          {/* Date */}
                          {result.publishedDate && (
                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                              <FaCalendarAlt className="w-3.5 h-3.5" />
                              <span>{formatDate(result.publishedDate)}</span>
                            </div>
                          )}

                          {/* Attachments */}
                          {result.attachments?.length > 0 && (
                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                              <FaFolderOpen className="w-3.5 h-3.5" />
                              <span>
                                {result.attachments.length}{" "}
                                {result.attachments.length === 1 ? t("attachment") : t("attachments")}
                              </span>
                            </div>
                          )}

                          {/* Projects */}
                          {result.projects?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-2">
                              {result.projects.slice(0, 2).map((project) => (
                                <span
                                  key={project.id || project.slug}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                >
                                  {project.title}
                                </span>
                              ))}
                              {result.projects.length > 2 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                                  +{result.projects.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="no-results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-16"
              >
                <FaFileAlt className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  {t("noResults")}
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  {t("noResultsDescription")}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
