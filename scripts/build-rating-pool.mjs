// Builds the clip pool raters listen to: every survey recording, converted to a normalised mono m4a
// (plays on iPhones, unlike the webm uploads), with leading/trailing silence trimmed to ~150 ms.
// Writes the audio to S3 under --prefix and upserts rows into rating_clips.
//
// Requires ffmpeg/ffprobe, and the rating tables (created the first time the admin page or a
// /rate link loads). Env: POSTGRES_URL plus the S3_* variables used by the app.
//
//   node scripts/build-rating-pool.mjs [--prefix qrf/rating-audio] [--round 1] [--limit N]
//        [--recordings-json path]   # read recordings from a JSON export instead of the database
//        [--only-missing]           # skip recordings already in rating_clips
//
// Unusable recordings (missing, under 4 KB, or not decodable) are left out and listed in the report.
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import pg from "pg"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

const run = promisify(execFile)
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : []
  ).filter((x) => x.length)
)
const PREFIX = String(args.prefix ?? "qrf/rating-audio").replace(/\/$/, "")
const ROUND = Number(args.round ?? 1)
const LIMIT = args.limit ? Number(args.limit) : Infinity
const CONCURRENCY = 4
const MIN_BYTES = 4000

const s3 = new S3Client({
  region: process.env.S3_AWS_REGION,
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(process.env.S3_ENDPOINT),
  credentials: {
    accessKeyId: process.env.S3_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_AWS_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})
const Bucket = process.env.S3_BUCKET
const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.POSTGRES_URL ?? "") ? false : { rejectUnauthorized: false },
})

// ffmpeg can hang on a malformed file; a timeout turns that into a skip instead of a stuck run.
const FFMPEG_TIMEOUT_MS = 60_000

// Decodes the whole file and reads the last timestamp. Browser webm uploads carry no duration in
// their header, so ffprobe's format=duration is N/A for them; decoding also proves the audio plays.
async function probeSeconds(file) {
  const { stderr } = await run("ffmpeg", ["-nostdin", "-v", "error", "-stats", "-i", file, "-f", "null", "-"], {
    timeout: FFMPEG_TIMEOUT_MS,
  })
  const times = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)]
  const last = times.at(-1)
  const s = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN
  if (!Number.isFinite(s) || s <= 0) throw new Error("no decodable audio")
  return s
}

const TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15"
async function encode(input, output, trim) {
  const filters = [...(trim ? [TRIM, "areverse", TRIM, "areverse"] : []), "loudnorm=I=-20:TP=-2:LRA=11"]
  await run(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-y", "-i", input, "-af", filters.join(","), "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output],
    { timeout: FFMPEG_TIMEOUT_MS }
  )
}

async function processOne(rec, dir) {
  let bytes
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: rec.s3_key }))
    bytes = Buffer.from(await obj.Body.transformToByteArray())
  } catch (e) {
    return { status: "missing", reason: e.name }
  }
  if (bytes.length < MIN_BYTES) return { status: "empty", reason: `${bytes.length} bytes` }

  const input = path.join(dir, `src-${rec.id}${path.extname(rec.s3_key)}`)
  const output = path.join(dir, `${rec.id}.m4a`)
  await writeFile(input, bytes)
  try {
    await probeSeconds(input)
    // If trimming fails or leaves almost nothing, keep the untrimmed clip and let raters judge it.
    const trimmed = await encode(input, output, true).then(() => probeSeconds(output), () => 0)
    if (trimmed < 0.3) await encode(input, output, false)
  } catch (e) {
    return { status: "corrupt", reason: String(e.stderr || e.message).trim().split("\n")[0] }
  }
  const durationMs = Math.round((await probeSeconds(output)) * 1000)
  const key = `${PREFIX}/${rec.id}.m4a`
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: await readFile(output), ContentType: "audio/mp4" }))
  await db.query(
    `insert into rating_clips (id, response_id, stimulus_id, stimulus_text_ar, kind, letter, harakah,
                               source_s3_key, audio_s3_key, duration_ms, round)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (id) do update set audio_s3_key = excluded.audio_s3_key,
       duration_ms = excluded.duration_ms, source_s3_key = excluded.source_s3_key, active = true`,
    [rec.id, rec.response_id, rec.stimulus_id, rec.stimulus_text_ar, rec.kind, rec.letter, rec.harakah,
     rec.s3_key, key, durationMs, ROUND]
  )
  return { status: "ok", durationMs }
}

await db.connect()
const tables = await db.query(`select to_regclass('public.rating_clips') is not null as ok`)
if (!tables.rows[0].ok) {
  console.error("rating_clips does not exist yet: open the admin page once (it creates the rating tables), then rerun.")
  process.exit(1)
}

let recs = args["recordings-json"]
  ? JSON.parse(await readFile(String(args["recordings-json"]), "utf8"))
  : (await db.query(`select id, response_id, stimulus_id, stimulus_text_ar, kind, letter, harakah, s3_key from recordings`)).rows
if (args["only-missing"]) {
  const have = new Set((await db.query(`select id from rating_clips`)).rows.map((r) => r.id))
  recs = recs.filter((r) => !have.has(r.id))
}
recs = recs.slice(0, LIMIT)

const dir = await mkdtemp(path.join(tmpdir(), "rating-pool-"))
const report = { ok: 0, skipped: [] }
let next = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < recs.length) {
      const rec = recs[next++]
      const res = await processOne(rec, dir)
      if (res.status === "ok") report.ok++
      else report.skipped.push({ recording: rec.id, response: rec.response_id, stimulus: rec.stimulus_id, ...res })
      const n = report.ok + report.skipped.length
      if (n % 50 === 0 || n === recs.length) console.error(`${n}/${recs.length}`)
    }
  })
)
await rm(dir, { recursive: true, force: true })
await db.end()
console.log(JSON.stringify({ prefix: PREFIX, round: ROUND, processed: recs.length, ...report }, null, 1))
