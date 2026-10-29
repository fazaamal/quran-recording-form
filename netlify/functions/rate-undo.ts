import type { Context } from "@netlify/functions"
import { db } from "./_shared"
import { ensureRatingSchema, json, raterByToken, raterState, text } from "./_rating"

// Removes the rater's most recent answer, so that item becomes the current one again.
export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "POST") return text("Method not allowed", 405)
    await ensureRatingSchema()
    const body = JSON.parse((await req.text()) || "{}") as { t?: string }
    const rater = await raterByToken(body.t)
    if (!rater) return text("This rating link is not valid.", 404)
    await db().query(
      `delete from rating_ratings where id = (
         select id from rating_ratings where rater_id = $1 order by created_at desc limit 1)`,
      [rater.id]
    )
    return json(await raterState(rater.id))
  } catch (e) {
    console.error("rate-undo", e)
    return text(e instanceof Error ? e.message : "Server error", 500)
  }
}
