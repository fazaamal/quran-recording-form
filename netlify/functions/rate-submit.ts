import type { Context } from "@netlify/functions"
import { db, newId } from "./_shared"
import { PROBLEMS, ensureRatingSchema, json, raterByToken, raterState, text } from "./_rating"

type Req = {
  t: string
  position: number
  score?: number | null
  problem?: string | null
  note?: string | null
  plays?: number
  ms?: number
}

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "POST") return text("Method not allowed", 405)
    await ensureRatingSchema()
    const body = JSON.parse((await req.text()) || "{}") as Req
    const rater = await raterByToken(body.t)
    if (!rater) return text("This rating link is not valid.", 404)

    const score = body.score ?? null
    const problem = body.problem ?? null
    if (score === null && problem === null) return text("A score or a problem is required", 400)
    if (score !== null && !(Number.isInteger(score) && score >= 1 && score <= 10))
      return text("Score must be a whole number from 1 to 10", 400)
    if (problem !== null && !(problem in PROBLEMS)) return text("Unknown problem type", 400)

    const pool = db()
    const q = await pool.query(
      `select clip_id, is_repeat from rating_queue where rater_id = $1 and position = $2`,
      [rater.id, body.position]
    )
    if (!q.rowCount) return text("Unknown item", 400)
    const { clip_id, is_repeat } = q.rows[0]

    // Upsert: re-rating after an undo replaces the earlier answer for that position.
    await pool.query(
      `insert into rating_ratings
         (id, rater_id, position, clip_id, is_repeat, score, problem, problem_note, plays, ms_to_rate)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (rater_id, position) do update set
         score = excluded.score, problem = excluded.problem, problem_note = excluded.problem_note,
         plays = excluded.plays, ms_to_rate = excluded.ms_to_rate, created_at = now()`,
      [
        newId("rt"),
        rater.id,
        body.position,
        clip_id,
        is_repeat,
        score,
        problem,
        problem === "other" ? (body.note ?? "").slice(0, 500) || null : null,
        Math.max(0, Math.min(1000, Math.round(body.plays ?? 0))),
        Math.max(0, Math.min(3_600_000, Math.round(body.ms ?? 0))),
      ]
    )
    return json(await raterState(rater.id))
  } catch (e) {
    console.error("rate-submit", e)
    return text(e instanceof Error ? e.message : "Server error", 500)
  }
}
