import { adminHomeContent } from './page-content';

export default function AdminHomePage() {
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Carespaces</p>
        <h1>{adminHomeContent.title}</h1>
        <p>{adminHomeContent.description}</p>
      </header>
      <section aria-labelledby="queue-title">
        <h2 id="queue-title">{adminHomeContent.queueTitle}</h2>
        <div className="grid">
          {adminHomeContent.queues.map((queue) => (
            <article key={queue}>
              <h3>{queue}</h3>
              <strong>0</strong>
              <span>open items</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
