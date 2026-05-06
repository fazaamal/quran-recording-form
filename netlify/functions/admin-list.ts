import { checkBasicAuth, ensureSchema, presignGet } from "./_shared"
import { db } from "./_shared"
import type { Context } from "@netlify/functions"

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "GET")
      return new Response("Method not allowed", { status: 405 })
    if (!checkBasicAuth(req.headers.get("authorization") ?? undefined)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="Admin"',
        },
      })
    }

    await ensureSchema()
    const pool = db()
    const { rows } = await pool.query(
      `select id, created_at, name, tajweed_level, years_reading, age, ethnicity, had_tajweed_classes, signed_consent_s3_key
       from responses
       order by created_at desc
       limit 500`
    )

    const responses = await Promise.all(
      rows.map(async (r: any) => {
        let signedConsentUrl: string | null = null
        if (r.signed_consent_s3_key) {
          try {
            signedConsentUrl = await presignGet({
              key: r.signed_consent_s3_key as string,
            })
          } catch {
            signedConsentUrl = null
          }
        }
        return {
          id: r.id as string,
          createdAt: (r.created_at as Date).toISOString(),
          name: r.name as string,
          tajweedLevel: r.tajweed_level as string,
          yearsReading: r.years_reading as number,
          age: r.age as number,
          ethnicity: r.ethnicity as string,
          hadTajweedClasses: Boolean(r.had_tajweed_classes),
          signedConsentUrl,
        }
      })
    )

    return new Response(JSON.stringify({ responses }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  } catch (e) {
    console.error("admin-list", e)
    return new Response(e instanceof Error ? e.message : "Server error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
}
