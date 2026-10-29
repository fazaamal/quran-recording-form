import { db, presignGet } from "./_shared"

// Inter-rater scoring of the survey recordings.
// Raters open /rate/<token>; each rater has their own fixed queue of clips (blind, shuffled,
// with ~5% hidden repeats for intra-rater consistency). Audio is served from rating_clips.audio_s3_key,
// a normalised m4a made by scripts/build-rating-pool.mjs, not the raw upload.

export const PROBLEMS = {
  unplayable: "Won't play / corrupt",
  silent: "Silent or no speech",
  noisy: "Too noisy or distorted to judge",
  wrong_item: "Different letter or word recited",
  other: "Other",
} as const
export type Problem = keyof typeof PROBLEMS

const REPEAT_SHARE = 0.05
const REPEAT_MIN_GAP = 40

export async function ensureRatingSchema() {
  const pool = db()
  await pool.query(`
    create table if not exists rating_clips (
      id text primary key,
      response_id text not null,
      stimulus_id text not null,
      stimulus_text_ar text not null,
      kind text not null,
      letter text not null,
      harakah text not null,
      source_s3_key text not null,
      audio_s3_key text not null,
      duration_ms int,
      round int not null default 1,
      is_gold boolean not null default false,
      gold_label text,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    create table if not exists rating_raters (
      id text primary key,
      name text not null,
      token text not null unique,
      seed int not null,
      round int not null default 1,
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    create table if not exists rating_queue (
      rater_id text not null references rating_raters(id) on delete cascade,
      position int not null,
      clip_id text not null references rating_clips(id),
      is_repeat boolean not null default false,
      primary key (rater_id, position)
    );
    create table if not exists rating_ratings (
      id text primary key,
      rater_id text not null references rating_raters(id) on delete cascade,
      position int not null,
      clip_id text not null references rating_clips(id),
      is_repeat boolean not null,
      score int check (score between 1 and 10),
      problem text,
      problem_note text,
      plays int not null default 0,
      ms_to_rate int not null default 0,
      created_at timestamptz not null default now(),
      unique (rater_id, position),
      check (score is not null or problem is not null)
    );
  `)
}

// Deterministic PRNG so a rater's queue can be rebuilt from their seed.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(xs: T[], rand: () => number) {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Blocks by stimulus (shuffled block order, shuffled within block), plus hidden repeats placed later. */
export function buildQueue(
  clips: { id: string; stimulus_id: string }[],
  seed: number
): { clipId: string; isRepeat: boolean }[] {
  const rand = mulberry32(seed)
  const blocks = new Map<string, string[]>()
  for (const c of clips) {
    const b = blocks.get(c.stimulus_id) ?? []
    b.push(c.id)
    blocks.set(c.stimulus_id, b)
  }
  const main = shuffle([...blocks.keys()], rand).flatMap((k) =>
    shuffle(blocks.get(k)!, rand)
  )

  const keyed = main.map((clipId, i) => ({ key: i, clipId, isRepeat: false }))
  const nRepeats = Math.round(main.length * REPEAT_SHARE)
  const eligible = main
    .map((clipId, i) => ({ clipId, i }))
    .filter(({ i }) => i + REPEAT_MIN_GAP < main.length)
  for (const { clipId, i } of shuffle(eligible, rand).slice(0, nRepeats)) {
    const lo = i + REPEAT_MIN_GAP
    keyed.push({ key: lo + rand() * (main.length - lo), clipId, isRepeat: true })
  }
  return keyed.sort((a, b) => a.key - b.key).map(({ clipId, isRepeat }) => ({ clipId, isRepeat }))
}

export async function raterByToken(token: string | null | undefined) {
  if (!token || token.length < 16) return null
  const { rows } = await db().query(
    `select id, name, round from rating_raters where token = $1 and active`,
    [token]
  )
  return (rows[0] as { id: string; name: string; round: number } | undefined) ?? null
}

type QueueRow = {
  position: number
  clip_id: string
  stimulus_text_ar: string
  letter: string
  harakah: string
  kind: string
  audio_s3_key: string
}

async function clipPayload(r: QueueRow) {
  return {
    position: r.position,
    textAr: r.stimulus_text_ar,
    letter: r.letter,
    harakah: r.harakah,
    kind: r.kind,
    audioUrl: await presignGet({ key: r.audio_s3_key, expiresInSeconds: 60 * 60 * 6 }),
  }
}

/** Progress plus the next unrated item (and the one after it, for preloading). Repeat flags stay server-side. */
export async function raterState(raterId: string) {
  const pool = db()
  const counts = await pool.query(
    `select (select count(*) from rating_queue where rater_id = $1)::int as total,
            (select count(*) from rating_ratings where rater_id = $1)::int as done`,
    [raterId]
  )
  const { rows } = await pool.query(
    `select q.position, q.clip_id, c.stimulus_text_ar, c.letter, c.harakah, c.kind, c.audio_s3_key
     from rating_queue q
     join rating_clips c on c.id = q.clip_id
     left join rating_ratings r on r.rater_id = q.rater_id and r.position = q.position
     where q.rater_id = $1 and r.id is null
     order by q.position
     limit 2`,
    [raterId]
  )
  const last = await pool.query(
    `select position from rating_ratings where rater_id = $1 order by created_at desc limit 1`,
    [raterId]
  )
  return {
    total: counts.rows[0].total as number,
    done: counts.rows[0].done as number,
    canUndo: last.rowCount! > 0,
    current: rows[0] ? await clipPayload(rows[0] as QueueRow) : null,
    preloadUrl: rows[1] ? (await clipPayload(rows[1] as QueueRow)).audioUrl : null,
  }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

export function text(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
