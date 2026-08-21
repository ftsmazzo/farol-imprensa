import { useEffect, useState, type FormEvent } from "react";
import "./App.css";
import {
  getDeviceId,
  subscribePush,
  testPush,
  unsubscribePush,
} from "./pushClient";

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

const UF_KEY = "farol_uf";

const NE_UFS = [
  { uf: "AL", name: "Alagoas" },
  { uf: "BA", name: "Bahia" },
  { uf: "CE", name: "Ceará" },
  { uf: "MA", name: "Maranhão" },
  { uf: "PB", name: "Paraíba" },
  { uf: "PE", name: "Pernambuco" },
  { uf: "PI", name: "Piauí" },
  { uf: "RN", name: "Rio Grande do Norte" },
  { uf: "SE", name: "Sergipe" },
];

function readUf() {
  if (typeof window === "undefined") return "PE";
  const q = new URLSearchParams(window.location.search).get("uf");
  if (q && NE_UFS.some((x) => x.uf === q.toUpperCase())) return q.toUpperCase();
  try {
    const saved = localStorage.getItem(UF_KEY);
    if (saved && NE_UFS.some((x) => x.uf === saved)) return saved;
  } catch {
    /* ignore */
  }
  return "PE";
}

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
  const [tab, setTab] = useState<"ler" | "alertas">("ler");
  const [uf, setUf] = useState(readUf);
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
  const [prefThemes, setPrefThemes] = useState<string[]>(["política"]);
  const [prefPeople, setPrefPeople] = useState("");
  const [pushOn, setPushOn] = useState(false);

  const loadMeta = () => fetch("/api/meta").then((r) => r.json()).then(setMeta);

  const loadAlerts = async () => {
    const [r, e] = await Promise.all([
      fetch("/api/alerts/rules").then((x) => x.json()),
      fetch("/api/alerts/events?limit=12").then((x) => x.json()),
    ]);
    setRules(Array.isArray(r) ? r.filter((x: AlertRule) => x.active) : []);
    setEvents(Array.isArray(e) ? e : []);
  };

  const digestUrl = (date: string, themeVal: string, query: string, ufVal = uf) => {
    const params = new URLSearchParams({ uf: ufVal, date });
    if (themeVal && themeVal !== "todos") params.set("theme", themeVal);
    if (query.trim()) params.set("q", query.trim());
    return `/api/digest?${params}`;
  };

  const loadDigest = async (
    which: "today" | "yesterday",
    opts?: { theme?: string; q?: string; base?: Digest; uf?: string }
  ) => {
    const themeVal = opts?.theme ?? theme;
    const query = opts?.q ?? q;
    const ufVal = opts?.uf ?? uf;
    const info =
      opts?.base ||
      anchors ||
      (await fetch(`/api/digest?uf=${ufVal}`).then((r) => r.json()));
    if (!anchors && info.today && info.yesterday) {
      setAnchors({ today: info.today, yesterday: info.yesterday });
    }
    const date = which === "today" ? info.today : info.yesterday;
    const d = await fetch(digestUrl(date, themeVal, query, ufVal)).then((r) => r.json());
    setDigest(d);
  };

  useEffect(() => {
    try {
      localStorage.removeItem("farol_admin");
    } catch {
      /* ignore */
    }

    const boot = async () => {
      const jobs: Promise<unknown>[] = [
        fetch("/api/meta").then((r) => r.json()).then(setMeta),
        fetch(`/api/digest?uf=${uf}`).then((r) => r.json()),
        fetch(`/api/push/me?deviceId=${encodeURIComponent(getDeviceId())}`)
          .then((r) => r.json())
          .then((me) => {
            if (me?.active) {
              setPushOn(true);
              if (Array.isArray(me.themes) && me.themes.length) setPrefThemes(me.themes);
              if (Array.isArray(me.keywords) && me.keywords.length) {
                setPrefPeople(me.keywords.join(", "));
              }
            }
          })
          .catch(() => {}),
      ];
      if (admin) jobs.push(loadAlerts());
      const results = await Promise.all(jobs);
      const base = results[1] as Digest;
      if (base?.today && base?.yesterday) {
        setAnchors({ today: base.today, yesterday: base.yesterday });
      }
      await loadDigest("today", { base });
    };

    boot().catch((e) => setError(String(e)));
  }, [admin, uf]);

  const changeUf = async (next: string) => {
    const u = next.toUpperCase();
    setUf(u);
    try {
      localStorage.setItem(UF_KEY, u);
    } catch {
      /* ignore */
    }
    setAnchors(null);
    setError(null);
    setTheme("todos");
    setQ("");
    setQDraft("");
    try {
      const base = await fetch(`/api/digest?uf=${u}`).then((r) => r.json());
      if (base.today && base.yesterday) {
        setAnchors({ today: base.today, yesterday: base.yesterday });
      }
      await loadDigest(day, { uf: u, theme: "todos", q: "", base });
    } catch (e) {
      setError(String(e));
    }
  };

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
        body: JSON.stringify({ uf }),
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
          uf,
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

  const togglePrefTheme = (t: string) => {
    setPrefThemes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const savePushPrefs = async () => {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (!prefThemes.length && !prefPeople.trim()) {
        throw new Error("Escolha ao menos 1 tema ou 1 pessoa/palavra.");
      }
      const keywords = prefPeople
        .split(/[,;|/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await subscribePush(prefThemes, keywords, uf);
      setPushOn(true);
      setFlash("Alertas ativados neste aparelho.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const stopPush = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribePush();
      setPushOn(false);
      setFlash("Alertas desativados neste aparelho.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendTestPush = async () => {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const j = await testPush();
      if (j.dispatch?.ok && j.dispatch?.status === "sent") {
        setFlash("Push de teste enviado — olhe as notificações do sistema.");
      } else if (j.dispatch?.queued) {
        setFlash("Push enfileirado (servidor sem VAPID).");
      } else {
        setFlash(`Push teste: ${j.dispatch?.error || j.dispatch?.status || "ok"}`);
      }
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
          <div>
            <p className="brand">Farol</p>
            <p className="tag">Imprensa do Nordeste no seu celular</p>
          </div>
          <label className="uf-pick">
            <span>Estado</span>
            <select
              value={uf}
              onChange={(e) => changeUf(e.target.value)}
              aria-label="Estado"
            >
              {NE_UFS.map((x) => (
                <option key={x.uf} value={x.uf}>
                  {x.uf} — {x.name}
                </option>
              ))}
            </select>
          </label>
          <nav className="consumer-nav" aria-label="Navegação">
            <button
              type="button"
              className={tab === "ler" ? "nav on" : "nav"}
              onClick={() => {
                setTab("ler");
                setError(null);
              }}
            >
              Ler
            </button>
            <button
              type="button"
              className={tab === "alertas" ? "nav on" : "nav"}
              onClick={() => {
                setTab("alertas");
                setError(null);
              }}
            >
              Meus alertas
            </button>
          </nav>
        </header>

        {error && <p className="err">{error}</p>}
        {flash && <p className="note">{flash}</p>}

        {tab === "ler" ? (
          <>
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
                <span> · {uf}</span>
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
          </>
        ) : (
          <section className="prefs" aria-label="Meus alertas">
            <h1>Meus alertas</h1>
            <p className="prefs-lead">
              Escolha temas e pessoas em {uf}. Ative o push e teste neste aparelho.
            </p>

            <p className="prefs-label">Temas</p>
            <div className="theme-tabs" role="group" aria-label="Temas para alertar">
              {PREF_THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={prefThemes.includes(t) ? "tab on" : "tab"}
                  onClick={() => togglePrefTheme(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <p className="prefs-label">Pessoas ou palavras</p>
            <form
              className="prefs-form"
              onSubmit={(e) => {
                e.preventDefault();
                savePushPrefs();
              }}
            >
              <input
                type="text"
                placeholder="Ex.: Raquel Lyra, Cabrobó"
                value={prefPeople}
                onChange={(e) => setPrefPeople(e.target.value)}
                aria-label="Pessoas ou palavras"
              />
              <button
                type="submit"
                className="btn"
                disabled={busy || meta?.pushConfigured === false}
              >
                {busy ? "Aguarde…" : pushOn ? "Salvar e manter ativo" : "Ativar alertas"}
              </button>
            </form>

            {meta?.pushConfigured === false && (
              <p className="prefs-hint">Servidor sem VAPID — push indisponível no momento.</p>
            )}

            {pushOn && (
              <div className="prefs-active">
                <p>
                  Ativo
                  {prefThemes.length ? ` · ${prefThemes.join(", ")}` : ""}
                  {prefPeople.trim() ? ` · ${prefPeople}` : ""}
                </p>
                <div className="actions">
                  <button type="button" className="btn" onClick={sendTestPush} disabled={busy}>
                    Testar push
                  </button>
                  <button type="button" className="btn ghost" onClick={stopPush} disabled={busy}>
                    Desativar
                  </button>
                </div>
              </div>
            )}

            <p className="prefs-hint">
              No iPhone: adicione o Farol à Tela de Início (Compartilhar → Tela de Início), abra pelo
              ícone e ative os alertas de lá. Safari solto no site costuma bloquear push.
            </p>
          </section>
        )}

        <footer className="foot consumer-foot">Farol · Nordeste</footer>
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
                <strong>{meta?.sprint ?? 7}</strong>
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
              <label className="uf-pick compact">
                <span>UF</span>
                <select value={uf} onChange={(e) => changeUf(e.target.value)} aria-label="UF">
                  {NE_UFS.map((x) => (
                    <option key={x.uf} value={x.uf}>
                      {x.uf}
                    </option>
                  ))}
                </select>
              </label>
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
