"use client";

import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('@/components/Editor'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="animate-pulse flex flex-col items-center gap-4 text-neutral-500">
        <div className="w-8 h-8 border-4 border-neutral-300 border-t-neutral-800 rounded-full animate-spin"></div>
        <p>Loading Workspace...</p>
      </div>
    </div>
  )
});

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans selection:bg-blue-500/30">
      <Editor />
    </main>
  );
}
