import { useEffect, useState } from "react";
import "./App.css";

type Meta = {
  service?: string;
  sprint?: number;
  pilotUf?: string;
  sources?: number;
  sourcesWithRss?: number;
  articles?: number;
  alertRules?: number;
  db?: boolean;
  note?: string;
  lastArticleAt?: string | null;
  lastFetchAt?: string | null;
  ingestRunning?: boolean;
};

type DigestItem = {
  id: number;
  title: string;
  url: string;
  source: string | null;
  theme: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  summary?: string | null;
};

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<DigestItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const load = () =>
    Promise.all([
      fetch("/api/meta").then((r) => r.json()),
      fetch(`/api/digest?uf=PE&date=${today}`).then((r) => r.json()),
    ])
      .then(([m, d]) => {
        setMeta(m);
        setItems(Array.isArray(d.items) ? d.items : []);
        setNote(d.note || m.note || null);
      })
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, [today]);

  const runIngest = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/ingest/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uf: "PE" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setNote(
        `Coleta: ${j.inserted} novas · ${j.skipped} já existiam · ${j.errors} erros · ${j.sources} fontes`
      );
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

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
        <div>
          <h1>Digest · Pernambuco</h1>
          <p>
            {meta?.lastFetchAt
              ? `Última coleta ${fmtWhen(meta.lastFetchAt)}`
              : "Ainda sem coleta — rode uma vez para acender o farol."}
          </p>
        </div>
        <button type="button" className="btn" onClick={runIngest} disabled={busy}>
          {busy ? "Coletando…" : "Coletar agora"}
        </button>
      </section>

      {error && <p className="err">{error}</p>}
      {note && <p className="note">{note}</p>}

      <section className="board">
        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Sem matérias ainda</p>
            <p>Clique em <strong>Coletar agora</strong> para puxar RSS / Google News das fontes PE.</p>
          </div>
        ) : (
          <ul className="feed">
            {items.map((it) => (
              <li key={it.id}>
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
                <span>
                  {fmtWhen(it.publishedAt || it.fetchedAt)}
                  {it.source ? ` · ${it.source}` : ""}
                  {it.theme ? ` · ${it.theme}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        Paralelo ao Radar Imprensa · Sprint {meta?.sprint ?? 2} · monitoramento, não ranking
      </footer>
    </div>
  );
}
