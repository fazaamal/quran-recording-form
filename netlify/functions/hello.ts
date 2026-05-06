import type { Context } from "@netlify/functions"

export default async (_req: Request, _context: Context) => {
  return new Response("Hello, world!", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
