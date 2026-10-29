import type { Context } from "@netlify/functions"
import { PROBLEMS, ensureRatingSchema, json, raterByToken, raterState, text } from "./_rating"

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "GET") return text("Method not allowed", 405)
    await ensureRatingSchema()
    const rater = await raterByToken(new URL(req.url).searchParams.get("t"))
    if (!rater) return text("This rating link is not valid.", 404)
    return json({ rater: { name: rater.name }, problems: PROBLEMS, ...(await raterState(rater.id)) })
  } catch (e) {
    console.error("rate-session", e)
    return text(e instanceof Error ? e.message : "Server error", 500)
  }
}
