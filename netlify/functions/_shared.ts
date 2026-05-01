import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { Pool } from "pg";
import { Readable } from "node:stream";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function s3() {
  const region = requireEnv("AWS_REGION");
  const endpoint = process.env["S3_ENDPOINT"];
  const forcePathStyle =
    process.env["S3_FORCE_PATH_STYLE"] === "true" || Boolean(endpoint?.trim());
  return new S3Client({
    region,
    ...(endpoint?.trim() ? { endpoint: endpoint.trim() } : {}),
    ...(forcePathStyle ? { forcePathStyle: true } : {}),
  });
}

export function s3Bucket() {
  return requireEnv("S3_BUCKET");
}

export function newId(prefix?: string) {
  const id = nanoid(16);
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso() {
  return new Date().toISOString();
}

let _pool: Pool | null = null;
export function db() {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: requireEnv("POSTGRES_URL") });
  return _pool;
}

export async function ensureSchema() {
  const pool = db();
  await pool.query(`
    create table if not exists responses (
      id text primary key,
      created_at timestamptz not null default now(),
      tajweed_level text not null,
      years_reading int not null,
      age int not null,
      ethnicity text not null,
      signature_s3_key text not null,
      signed_consent_s3_key text
    );
  `);
  await pool.query(`
    alter table responses add column if not exists had_tajweed_classes boolean not null default false;
  `);
  await pool.query(`
    create table if not exists recordings (
      id text primary key,
      response_id text not null references responses(id) on delete cascade,
      stimulus_id text not null,
      stimulus_text_ar text not null,
      kind text not null,
      letter text not null,
      harakah text not null,
      s3_key text not null,
      content_type text not null,
      duration_ms int not null
    );
  `);
}

export function base64ToUtf8(b64: string) {
  return Buffer.from(b64, "base64").toString("utf8");
}

export function checkBasicAuth(authHeader: string | undefined) {
  const expectedUser = requireEnv("ADMIN_USER");
  const expectedPass = requireEnv("ADMIN_PASS");
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;
  const token = authHeader.slice("Basic ".length);
  const decoded = base64ToUtf8(token);
  return decoded === `${expectedUser}:${expectedPass}`;
}

export async function presignPut(params: { key: string; contentType: string; expiresInSeconds?: number }) {
  const client = s3();
  const bucket = s3Bucket();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
  });
  const url = await getSignedUrl(client, cmd, { expiresIn: params.expiresInSeconds ?? 60 * 10 });
  return url;
}

export async function presignGet(params: { key: string; expiresInSeconds?: number }) {
  const client = s3();
  const bucket = s3Bucket();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: params.key });
  const url = await getSignedUrl(client, cmd, { expiresIn: params.expiresInSeconds ?? 60 * 60 });
  return url;
}

export async function readS3ToBuffer(key: string): Promise<Buffer> {
  const client = s3();
  const bucket = s3Bucket();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body) throw new Error("S3 object has no body");
  const stream = body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

