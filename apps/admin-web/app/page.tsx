const queues = [
  'Verification',
  'Clinical review',
  'Active incidents',
  'Finance',
];

export default function AdminHomePage() {
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Carespaces</p>
        <h1>Care Ops</h1>
        <p>Admin Web foundation — ยังไม่มีข้อมูลผู้ใช้งานจริง</p>
      </header>
      <section aria-labelledby="queue-title">
        <h2 id="queue-title">Operational queues</h2>
        <div className="grid">
          {queues.map((queue) => (
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
