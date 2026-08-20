import { useEffect, useState } from "react";
import "./App.css";

type Meta = {
  service?: string;
  sprint?: number;
  pilotUf?: string;
  sources?: number;
  articles?: number;
  alertRules?: number;
  db?: boolean;
  note?: string;
  lastArticleAt?: string | null;
};

type DigestItem = {
  id: number;
  title: string;
  url: string;
  source: string | null;
  theme: string | null;
  publishedAt: string | null;
};

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<DigestItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    Promise.all([
      fetch("/api/meta").then((r) => r.json()),
      fetch(`/api/digest?uf=PE&date=${today}`).then((r) => r.json()),
    ])
      .then(([m, d]) => {
        setMeta(m);
        setItems(Array.isArray(d.items) ? d.items : []);
      })
      .catch((e) => setError(String(e)));
  }, [today]);

  return (
    <div className="shell">
      <div className="sky" aria-hidden />

      <header className="top">
        <div>
          <p className="brand">Farol</p>
          <p className="tag">O que a imprensa publica agora — e quando você precisa saber</p>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span>Sprint</span>
            <strong>{meta?.sprint ?? "—"}</strong>
          </div>
          <div className="kpi">
            <span>Piloto</span>
            <strong>{meta?.pilotUf ?? "PE"}</strong>
          </div>
          <div className="kpi">
            <span>Fontes</span>
            <strong>{meta?.sources ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Matérias</span>
            <strong>{meta?.articles ?? 0}</strong>
          </div>
        </div>
      </header>

      <section className="hero-line">
        <h1>Digest do dia</h1>
        <p>
          Fundação pronta. A ingestão das fontes de PE entra no <strong>Sprint 2</strong>.
        </p>
      </section>

      {error && <p className="err">{error}</p>}
      {meta?.note && <p className="note">{meta.note}</p>}

      <section className="board">
        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Ainda sem matérias</p>
            <p>
              No Sprint 2 conectamos RSS dos veículos prioritários do Radar (PE) e o digest
              começa a acender.
            </p>
            <ol>
              <li>Seed de fontes PE</li>
              <li>Job de ingestão + dedup</li>
              <li>Lista ao vivo neste painel</li>
            </ol>
          </div>
        ) : (
          <ul className="feed">
            {items.map((it) => (
              <li key={it.id}>
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
                <span>
                  {it.source || "Fonte"}
                  {it.theme ? ` · ${it.theme}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        Paralelo ao Radar Imprensa · monitoramento, não ranking
      </footer>
    </div>
  );
}
