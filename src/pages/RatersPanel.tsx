import { useEffect, useState } from "react";
import {
  apiAdminCreateRater,
  apiAdminExportRatingsCsv,
  apiAdminRaters,
  type RaterRow,
} from "../utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const linkFor = (token: string) => `${window.location.origin}/rate/${token}`;

export function RatersPanel({ headers }: { headers: Record<string, string> }) {
  const [raters, setRaters] = useState<RaterRow[]>([]);
  const [clips, setClips] = useState<{ round: number; n: number }[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const res = await apiAdminRaters(headers);
      setRaters(res.raters);
      setClips(res.clipsByRound);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load raters");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers]);

  async function addRater() {
    setLoading(true);
    setError(null);
    try {
      await apiAdminCreateRater(headers, { name: name.trim() });
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add rater");
    } finally {
      setLoading(false);
    }
  }

  async function copy(token: string) {
    await navigator.clipboard.writeText(linkFor(token));
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  async function exportCsv() {
    setError(null);
    try {
      const blob = await apiAdminExportRatingsCsv(headers);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ratings-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  const poolSize = clips.find((c) => c.round === 1)?.n ?? 0;

  return (
    <div className="card stack">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 750 }}>Raters</div>
          <div className="muted">
            {poolSize.toLocaleString()} clips in the rating pool · each rater gets their own shuffled order
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="outline" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={exportCsv} disabled={!raters.length}>
            Export ratings (CSV)
          </Button>
        </div>
      </div>

      <form
        style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void addRater();
        }}
      >
        <Input
          placeholder="Rater name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <Button type="submit" disabled={!name.trim() || loading || !poolSize}>
          {loading ? "Adding…" : "Add rater"}
        </Button>
      </form>
      {!poolSize && (
        <div className="muted">The rating pool is empty. Run scripts/build-rating-pool.mjs first.</div>
      )}
      {error && <div style={{ color: "var(--danger)" }}>{error}</div>}

      {raters.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--app-muted)" }}>
              <th style={{ padding: "10px 8px" }}>Rater</th>
              <th style={{ padding: "10px 8px" }}>Progress</th>
              <th style={{ padding: "10px 8px" }}>Audio problems</th>
              <th style={{ padding: "10px 8px" }}>Last rated</th>
              <th style={{ padding: "10px 8px" }}>Link</th>
            </tr>
          </thead>
          <tbody>
            {raters.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--app-border)" }}>
                <td style={{ padding: "10px 8px", fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: "10px 8px", minWidth: 160 }}>
                  <div className="progressBar" style={{ height: 8 }}>
                    <div className="progressBarFill" style={{ width: `${(r.done / r.total) * 100}%`, background: "var(--app-accent)" }} />
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {r.done.toLocaleString()} / {r.total.toLocaleString()}
                  </div>
                </td>
                <td style={{ padding: "10px 8px" }}>{r.problems}</td>
                <td style={{ padding: "10px 8px" }} className="muted">
                  {r.last_rated_at ? new Date(r.last_rated_at).toLocaleString() : "Not started"}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <Button variant="outline" size="sm" onClick={() => void copy(r.token)}>
                    {copied === r.token ? "Copied" : "Copy link"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
