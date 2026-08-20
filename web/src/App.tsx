import { useEffect, useState, type FormEvent } from "react";
import "./App.css";

type Meta = {
  sprint?: number;
  sources?: number;
  articles?: number;
  lastFetchAt?: string | null;
};

type DigestItem = {
  id: number;
  title: string;
  url: string;
  source: string | null;
  theme?: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
};

type Digest = {
  date: string;
  today?: string;
  yesterday?: string;
  label?: string;
  count?: number;
  bySource?: { name: string; count: number }[];
  byTheme?: { name: string; count: number }[];
  items: DigestItem[];
  note?: string | null;
};

const THEME_CHIPS = [
  "todos",
  "política",
  "economia",
  "segurança",
  "saúde",
  "educação",
  "meio ambiente",
  "outros",
];

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
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
  const [digest, setDigest] = useState<Digest | null>(null);
  const [anchors, setAnchors] = useState<{ today: string; yesterday: string } | null>(null);
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [theme, setTheme] = useState("todos");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const loadMeta = () => fetch("/api/meta").then((r) => r.json()).then(setMeta);

  const digestUrl = (date: string, themeVal: string, query: string) => {
    const params = new URLSearchParams({ uf: "PE", date });
    if (themeVal && themeVal !== "todos") params.set("theme", themeVal);
    if (query.trim()) params.set("q", query.trim());
    return `/api/digest?${params}`;
  };

  const loadDigest = async (
    which: "today" | "yesterday",
    opts?: { theme?: string; q?: string; base?: Digest }
  ) => {
    const themeVal = opts?.theme ?? theme;
    const query = opts?.q ?? q;
    const info =
      opts?.base ||
      anchors ||
      (await fetch("/api/digest?uf=PE").then((r) => r.json()));
    if (!anchors && info.today && info.yesterday) {
      setAnchors({ today: info.today, yesterday: info.yesterday });
    }
    const date = which === "today" ? info.today : info.yesterday;
    const d = await fetch(digestUrl(date, themeVal, query)).then((r) => r.json());
    setDigest(d);
  };

  useEffect(() => {
    Promise.all([loadMeta(), fetch("/api/digest?uf=PE").then((r) => r.json())])
      .then(async ([, base]) => {
        if (base.today && base.yesterday) {
          setAnchors({ today: base.today, yesterday: base.yesterday });
        }
        await loadDigest("today", { base });
      })
      .catch((e) => setError(String(e)));
  }, []);

  const selectDay = async (which: "today" | "yesterday") => {
    setDay(which);
    setError(null);
    try {
      await loadDigest(which);
      await loadMeta();
    } catch (e) {
      setError(String(e));
    }
  };

  const selectTheme = async (next: string) => {
    setTheme(next);
    setError(null);
    try {
      await loadDigest(day, { theme: next });
    } catch (e) {
      setError(String(e));
    }
  };

  const applySearch = async (e?: FormEvent) => {
    e?.preventDefault();
    const next = qDraft.trim();
    setQ(next);
    setError(null);
    try {
      await loadDigest(day, { q: next });
    } catch (err) {
      setError(String(err));
    }
  };

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
      setFlash(`Coleta: ${j.inserted} novas · ${j.skipped} já existiam · ${j.errors} erros`);
      await selectDay(day);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const items = digest?.items || [];
  const topSources = (digest?.bySource || []).slice(0, 5);

  return (
    <div className="shell">
      <div className="sky" aria-hidden />

      <header className="top">
        <div>
          <p className="brand">Farol</p>
          <p className="tag">Digest do dia — o que a imprensa de PE publicou</p>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span>No dia</span>
            <strong>{digest?.count ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Fontes</span>
            <strong>{meta?.sources ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Base</span>
            <strong>{meta?.articles ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Sprint</span>
            <strong>{meta?.sprint ?? 4}</strong>
          </div>
        </div>
      </header>

      <section className="hero-line">
        <div>
          <h1>{digest?.label || "Digest"} · Pernambuco</h1>
          <p>
            {digest?.date || ""}
            {meta?.lastFetchAt ? ` · última coleta ${fmtWhen(meta.lastFetchAt)}` : ""}
          </p>
        </div>
        <div className="actions">
          <div className="day-tabs" role="tablist" aria-label="Dia">
            <button
              type="button"
              className={day === "today" ? "tab on" : "tab"}
              onClick={() => selectDay("today")}
            >
              Hoje
            </button>
            <button
              type="button"
              className={day === "yesterday" ? "tab on" : "tab"}
              onClick={() => selectDay("yesterday")}
            >
              Ontem
            </button>
          </div>
          <button type="button" className="btn" onClick={runIngest} disabled={busy}>
            {busy ? "Coletando…" : "Coletar agora"}
          </button>
        </div>
      </section>

      <section className="filters" aria-label="Filtros">
        <div className="theme-tabs" role="tablist" aria-label="Tema">
          {THEME_CHIPS.map((t) => (
            <button
              key={t}
              type="button"
              className={theme === t ? "tab on" : "tab"}
              onClick={() => selectTheme(t)}
            >
              {t === "todos" ? "Todos" : t}
            </button>
          ))}
        </div>
        <form className="search" onSubmit={applySearch}>
          <input
            type="search"
            placeholder="Buscar título, resumo ou veículo…"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            aria-label="Busca"
          />
          <button type="submit" className="btn ghost">
            Buscar
          </button>
        </form>
      </section>

      {error && <p className="err">{error}</p>}
      {(flash || digest?.note) && <p className="note">{flash || digest?.note}</p>}

      {topSources.length > 0 && (
        <div className="source-strip">
          {topSources.map((s) => (
            <span key={s.name} className="chip">
              {s.name} <b>{s.count}</b>
            </span>
          ))}
        </div>
      )}

      <section className="board">
        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Sem matérias neste filtro</p>
            <p>
              Ajuste o tema/busca, troque o dia ou rode <strong>Coletar agora</strong>.
            </p>
          </div>
        ) : (
          <ul className="feed">
            {items.map((it) => (
              <li key={it.id} className="row">
                <time dateTime={it.publishedAt || it.fetchedAt || undefined}>
                  {fmtTime(it.publishedAt || it.fetchedAt)}
                </time>
                <div className="row-body">
                  <a href={it.url} target="_blank" rel="noreferrer">
                    {it.title}
                  </a>
                  <span className="meta-line">
                    <span className="vehicle">{it.source || "Fonte"}</span>
                    {it.theme ? <span className="theme-tag">{it.theme}</span> : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        Farol · Sprint {meta?.sprint ?? 4} · paralelo ao Radar Imprensa
      </footer>
    </div>
  );
}
