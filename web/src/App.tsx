import { useEffect, useState, type FormEvent } from "react";
import "./App.css";

type Meta = {
  sprint?: number;
  sources?: number;
  articles?: number;
  alertRules?: number;
  alertWebhookConfigured?: boolean;
  pushConfigured?: boolean;
  lastFetchAt?: string | null;
};

type AlertRule = {
  id: number;
  name: string;
  keywords: string[];
  uf: string | null;
  active: boolean;
};

type AlertEvent = {
  id: number;
  ruleName: string;
  matchedOn: string;
  status: string;
  title: string;
  url: string;
  source: string | null;
  createdAt: string;
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
  items: DigestItem[];
  note?: string | null;
};

const PREF_THEMES = [
  "política",
  "economia",
  "segurança",
  "saúde",
  "educação",
  "meio ambiente",
];

/** Admin só com ?admin=1 na URL — não grava no localStorage. */
function readAdminMode() {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  return q.get("admin") === "1" || q.get("admin") === "true";
}

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
  const [admin] = useState(readAdminMode);
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
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [ruleName, setRuleName] = useState("");
  const [ruleKeywords, setRuleKeywords] = useState("");

  const loadMeta = () => fetch("/api/meta").then((r) => r.json()).then(setMeta);

  const loadAlerts = async () => {
    const [r, e] = await Promise.all([
      fetch("/api/alerts/rules").then((x) => x.json()),
      fetch("/api/alerts/events?limit=12").then((x) => x.json()),
    ]);
    setRules(Array.isArray(r) ? r.filter((x: AlertRule) => x.active) : []);
    setEvents(Array.isArray(e) ? e : []);
  };

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
    // limpa flag antiga que prendia o celular no modo equipe
    try {
      localStorage.removeItem("farol_admin");
    } catch {
      /* ignore */
    }

    const boot = async () => {
      const jobs: Promise<unknown>[] = [fetch("/api/digest?uf=PE").then((r) => r.json())];
      if (admin) {
        jobs.unshift(loadMeta());
        jobs.push(loadAlerts());
      }
      const results = await Promise.all(jobs);
      const base = (admin ? results[1] : results[0]) as Digest;
      if (base?.today && base?.yesterday) {
        setAnchors({ today: base.today, yesterday: base.yesterday });
      }
      await loadDigest("today", { base });
    };

    boot().catch((e) => setError(String(e)));
  }, [admin]);

  const selectDay = async (which: "today" | "yesterday") => {
    setDay(which);
    setError(null);
    try {
      await loadDigest(which);
      if (admin) await loadMeta();
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
      setFlash(
        `Coleta: ${j.inserted} novas · ${j.skipped} já existiam · ${j.errors} erros${j.alerts ? ` · ${j.alerts} alertas` : ""}`
      );
      await selectDay(day);
      await loadAlerts();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const createRule = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await fetch("/api/alerts/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: ruleName.trim(),
          keywords: ruleKeywords,
          uf: "PE",
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setRuleName("");
      setRuleKeywords("");
      setFlash(`Regra criada: ${j.name}`);
      await loadAlerts();
      await loadMeta();
    } catch (err) {
      setError(String(err));
    }
  };

  const rematchAlerts = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/alerts/rematch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setFlash(`Rematch: ${j.matched} novos eventos em ${j.scanned} artigos`);
      await loadAlerts();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const testAlert = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchedOn: "teste" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      const st = j.dispatch?.status || j.dispatch?.queued ? "queued" : j.dispatch?.error || "ok";
      setFlash(`Teste alerta #${j.eventId}: ${st}`);
      await loadAlerts();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const items = digest?.items || [];

  if (!admin) {
    return (
      <div className="shell consumer">
        <div className="sky" aria-hidden />

        <header className="consumer-top">
          <p className="brand">Farol</p>
          <p className="tag">O que a imprensa de PE publicou</p>
        </header>

        <section className="consumer-hero">
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
          <h1>
            {digest?.label || "Hoje"}
            <span> · PE</span>
          </h1>
          <p>{digest?.count ?? 0} matérias</p>
        </section>

        <div className="theme-tabs soft" role="tablist" aria-label="Tema">
          {["todos", ...PREF_THEMES].map((t) => (
            <button
              key={t}
              type="button"
              className={theme === t ? "tab on" : "tab"}
              onClick={() => selectTheme(t)}
            >
              {t === "todos" ? "Tudo" : t}
            </button>
          ))}
        </div>

        {error && <p className="err">{error}</p>}

        <section className="board consumer-board">
          {items.length === 0 ? (
            <div className="empty">
              <p className="empty-title">Nada por aqui ainda</p>
              <p>Volte mais tarde ou veja Ontem.</p>
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

        <footer className="foot consumer-foot">Farol · Pernambuco</footer>
      </div>
    );
  }

  return (
    <div className="shell admin">
      <div className="sky" aria-hidden />

      <header className="top">
        <div>
          <p className="brand">Farol</p>
          <p className="tag">Painel da equipe — ingestão e regras</p>
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
            <strong>{meta?.sprint ?? 6}</strong>
          </div>
        </div>
      </header>

      <section className="hero-line">
        <div>
          <h1>{digest?.label || "Digest"} · Admin</h1>
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
          <a className="btn ghost" href="/">
            Ver app
          </a>
        </div>
      </section>

      <section className="filters" aria-label="Filtros">
        <div className="theme-tabs" role="tablist" aria-label="Tema">
          {["todos", ...PREF_THEMES, "outros"].map((t) => (
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

      <section className="board">
        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Sem matérias neste filtro</p>
            <p>
              Ajuste busca/tema ou rode <strong>Coletar agora</strong>.
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

      <section className="alerts" aria-label="Alertas equipe">
        <div className="alerts-head">
          <div>
            <h2>Alertas (equipe)</h2>
            <p>
              {meta?.alertWebhookConfigured
                ? "Webhook n8n ativo."
                : "Configure N8N_ALERT_WEBHOOK no Easypanel."}
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={rematchAlerts} disabled={busy}>
              Rematch
            </button>
            <button type="button" className="btn ghost" onClick={testAlert} disabled={busy}>
              Testar n8n
            </button>
          </div>
        </div>

        <form className="rule-form" onSubmit={createRule}>
          <input
            type="text"
            placeholder="Nome da regra"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Keywords (vírgula)"
            value={ruleKeywords}
            onChange={(e) => setRuleKeywords(e.target.value)}
            required
          />
          <button type="submit" className="btn">
            Criar regra
          </button>
        </form>

        {rules.length > 0 && (
          <div className="source-strip">
            {rules.map((r) => (
              <span key={r.id} className="chip">
                {r.name} <b>{(r.keywords || []).join(", ")}</b>
              </span>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className={`st ${ev.status}`}>{ev.status}</span>
                <a href={ev.url} target="_blank" rel="noreferrer">
                  {ev.title}
                </a>
                <span className="vehicle">
                  {ev.ruleName} · “{ev.matchedOn}” · {ev.source || "Fonte"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">Farol · equipe · /?admin=1</footer>
    </div>
  );
}
