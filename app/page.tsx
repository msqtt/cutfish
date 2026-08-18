'use client';

import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('@/components/Editor'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--app)] text-[var(--muted)]" role="status">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-sm">Loading Cutfish…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <main className="min-h-dvh bg-[var(--app)] text-[var(--text)]"><Editor /></main>;
}
