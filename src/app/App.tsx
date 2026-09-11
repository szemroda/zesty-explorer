export function App() {
  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <span className="eyebrow">Local read-only browser</span>
          <h1>Zesty Explorer</h1>
        </div>
        <span className="status-dot">No collection open</span>
      </header>
      <section className="start-card" aria-labelledby="start-title">
        <p className="eyebrow">Start a view</p>
        <h2 id="start-title">Open a Zesty collection</h2>
        <p>Add your session token and a Content or Blocks collection URL.</p>
      </section>
    </main>
  );
}
