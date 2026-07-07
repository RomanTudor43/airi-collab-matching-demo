'use client';

import { useState } from 'react';

const PERSONAS = [
  'energy systems forecasting and smart grids',
  'biomedical imaging and deep learning',
  'robotics and autonomous systems',
  'integrated circuits design and pre-silicon verification',
];

const TOP = 5;

const fmtTerms = (n) => `${n} shared term${n === 1 ? '' : 's'}`;

export default function CollaboratePage() {
  const [interests, setInterests] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function search(text) {
    const list = String(text).split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) {
      setError('Please enter at least one research interest.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/collaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: list, top: TOP }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Find who to collaborate with
      </h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Describe your research interests and get the AIRi researchers and projects whose work is
        the closest match.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(interests);
        }}
        className="mt-6 flex flex-col gap-3 sm:flex-row"
      >
        <input
          type="text"
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="e.g. energy systems forecasting, smart grids"
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Match'}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {PERSONAS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setInterests(p);
              search(p);
            }}
            className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {p}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-8">
          <Section title="Researchers" items={result.researchers} render={Researcher} />
          <Section title="Projects" items={result.projects} render={Project} />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Matching: keyword overlap
            {result.coverage
              ? ` · ${result.coverage.scored} of ${result.coverage.publications} publications matched`
              : ''}
            {' · '}read-only.
          </p>
        </div>
      )}
    </main>
  );
}

function Section({ title, items, render }) {
  const strong = (items || []).filter((it) => !it.weak);
  const weak = (items || []).filter((it) => it.weak);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      {strong.length === 0 && weak.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No matches found.</p>
      )}
      <ol className="space-y-3">{strong.map(render)}</ol>
      {weak.length > 0 && (
        <>
          <p className="mt-4 mb-2 text-sm text-gray-500 dark:text-gray-400">
            {strong.length === 0
              ? 'No strong matches yet — the closest results, shown as low confidence:'
              : 'Weaker matches (low confidence):'}
          </p>
          <ol className="space-y-3 opacity-70">{weak.map(render)}</ol>
        </>
      )}
    </section>
  );
}

function Researcher(r) {
  return (
    <li
      key={`${r.rank}-${r.name}`}
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {r.name}
          {r.title ? (
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{r.title}</span>
          ) : null}
        </span>
        <span className={`text-xs ${r.weak ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
          {r.weak ? 'low confidence · ' : ''}
          {fmtTerms(r.topScore)}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{r.reason}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Contact: {r.contact} <span className="text-gray-400 dark:text-gray-500">[{r.contactSource}]</span>
      </p>
    </li>
  );
}

function Project(p) {
  return (
    <li
      key={`${p.rank}-${p.title}`}
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900 dark:text-gray-100">{p.title}</span>
        <span className={`text-xs ${p.weak ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
          {p.weak ? 'low confidence · ' : ''}
          {fmtTerms(p.score)}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{p.reason}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Contact: {p.contact} <span className="text-gray-400 dark:text-gray-500">[{p.contactSource}]</span>
      </p>
      {p.themes && p.themes.length > 0 && (
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Themes: {p.themes.join(', ')}</p>
      )}
    </li>
  );
}
