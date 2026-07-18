import { customerHomeContent } from './page-content';

export default function CustomerHomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">{customerHomeContent.eyebrow}</p>
      <h1>{customerHomeContent.title}</h1>
      <p className="lede">{customerHomeContent.description}</p>
      <div className="status" role="status">
        {customerHomeContent.status}
      </div>
    </main>
  );
}
