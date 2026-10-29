import type { Context } from "@netlify/functions"
import { randomInt } from "node:crypto"
import { checkBasicAuth, db, newId } from "./_shared"
import { buildQueue, ensureRatingSchema, json, text } from "./_rating"

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return ""
  const s = v instanceof Date ? v.toISOString() : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET                 → raters with progress, plus clip-pool counts
// GET ?export=csv     → every rating, one row each, joined with clip details
// POST {name, round?} → create a rater with their own shuffled queue
export default async (req: Request, _context: Context) => {
  try {
    if (!checkBasicAuth(req.headers.get("authorization") ?? undefined)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": 'Basic realm="Admin"' },
      })
    }
    await ensureRatingSchema()
    const pool = db()

    if (req.method === "GET" && new URL(req.url).searchParams.get("export") === "csv") {
      const { rows, fields } = await pool.query(
        `select r.id as rating_id, w.name as rater, r.rater_id, r.position, r.is_repeat,
                r.score, r.problem, r.problem_note, r.plays, r.ms_to_rate, r.created_at,
                c.id as recording_id, c.response_id, c.stimulus_id, c.kind, c.letter, c.harakah,
                c.round, c.is_gold, c.gold_label
         from rating_ratings r
         join rating_raters w on w.id = r.rater_id
         join rating_clips c on c.id = r.clip_id
         order by w.created_at, r.position`
      )
      const cols = fields.map((f) => f.name)
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n")
      return new Response(csv + "\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ratings-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    if (req.method === "GET") {
      const raters = await pool.query(
        `select w.id, w.name, w.token, w.round, w.created_at,
                (select count(*) from rating_queue q where q.rater_id = w.id)::int as total,
                (select count(*) from rating_ratings r where r.rater_id = w.id)::int as done,
                (select count(*) from rating_ratings r where r.rater_id = w.id and r.problem is not null)::int as problems,
                (select max(created_at) from rating_ratings r where r.rater_id = w.id) as last_rated_at
         from rating_raters w where w.active order by w.created_at`
      )
      const clips = await pool.query(
        `select round, count(*)::int as n from rating_clips where active group by round order by round`
      )
      return json({ raters: raters.rows, clipsByRound: clips.rows })
    }

    if (req.method === "POST") {
      const body = JSON.parse((await req.text()) || "{}") as { name?: string; round?: number }
      const name = (body.name ?? "").trim().slice(0, 80)
      if (!name) return text("Name is required", 400)
      const round = body.round ?? 1
      const clips = await pool.query(
        `select id, stimulus_id from rating_clips where active and round = $1`,
        [round]
      )
      if (!clips.rowCount) return text(`No clips in round ${round} yet`, 400)

      const id = newId("rater")
      const token = newId() + newId()
      const seed = randomInt(1, 2 ** 31 - 1)
      const queue = buildQueue(clips.rows, seed)
      const client = await pool.connect()
      try {
        await client.query("begin")
        await client.query(
          `insert into rating_raters (id, name, token, seed, round) values ($1,$2,$3,$4,$5)`,
          [id, name, token, seed, round]
        )
        await client.query(
          `insert into rating_queue (rater_id, position, clip_id, is_repeat)
           select $1, ord, clip_id, is_repeat
           from unnest($2::text[], $3::boolean[]) with ordinality as t(clip_id, is_repeat, ord)`,
          [id, queue.map((x) => x.clipId), queue.map((x) => x.isRepeat)]
        )
        await client.query("commit")
      } catch (e) {
        await client.query("rollback")
        throw e
      } finally {
        client.release()
      }
      return json({ id, name, token, total: queue.length })
    }

    return text("Method not allowed", 405)
  } catch (e) {
    console.error("admin-raters", e)
    return text(e instanceof Error ? e.message : "Server error", 500)
  }
}
