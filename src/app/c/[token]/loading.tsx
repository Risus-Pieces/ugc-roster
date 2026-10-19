export default function Loading() {
  return (
    <main className="board mx-3 my-4 max-w-xl animate-pulse px-5 pb-16 pt-7 sm:mx-auto sm:my-8 sm:px-7" aria-busy="true" aria-label="Loading">
      <div className="mb-3 h-3 w-40 rounded bg-sunken" />
      <div className="mb-2 h-8 w-32 rounded bg-sunken" />
      <div className="mb-5 h-4 w-72 max-w-full rounded bg-sunken" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="mb-4 h-48 rounded-xl border border-line bg-panel" />
      ))}
    </main>
  );
}
