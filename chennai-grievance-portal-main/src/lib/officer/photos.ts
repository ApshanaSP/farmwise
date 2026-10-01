/**
 * Photos attached to completion reports. They are stored outside `public/` and
 * served only through /api/officer/photos, which checks that the viewer is the
 * Collector or an officer of the department that sent the report (site photos can
 * show residents and their homes). The folder is configurable for hosted deployments.
 */
import { randomBytes } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

export const PHOTO_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export type PhotoExt = keyof typeof PHOTO_TYPES;

export const DIR_RE = /^\d{8}-[a-f0-9]{16}$/;
export const NAME_RE = /^\d{1,2}\.(jpg|png|webp)$/;

export function uploadRoot(): string {
  return path.resolve(process.env.OFFICER_UPLOAD_DIR || path.join(process.cwd(), "uploads", "officer-reports"));
}

/** File type from the first bytes, so a renamed file cannot pass as an image. */
export function sniff(buf: Buffer): PhotoExt | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function newPhotoDir(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${ymd}-${randomBytes(8).toString("hex")}`;
}

/** Writes the photos as 1.jpg, 2.png, ... and returns their names. */
export async function savePhotos(dir: string, files: { buf: Buffer; ext: PhotoExt }[]): Promise<string[]> {
  if (!DIR_RE.test(dir)) throw new Error("Invalid photo folder");
  const full = path.join(uploadRoot(), dir);
  await mkdir(full, { recursive: true });
  const names: string[] = [];
  for (const [k, f] of files.entries()) {
    const name = `${k + 1}.${f.ext}`;
    await writeFile(path.join(full, name), f.buf, { flag: "wx" });
    names.push(name);
  }
  return names;
}

export async function removePhotoDir(dir: string): Promise<void> {
  if (DIR_RE.test(dir)) await rm(path.join(uploadRoot(), dir), { recursive: true, force: true });
}

export async function readPhoto(dir: string, name: string): Promise<{ buf: Buffer; type: string } | null> {
  if (!DIR_RE.test(dir) || !NAME_RE.test(name)) return null;
  try {
    const buf = await readFile(path.join(uploadRoot(), dir, name));
    return { buf, type: PHOTO_TYPES[name.split(".")[1] as PhotoExt] };
  } catch {
    return null;
  }
}

export const photoUrl = (dir: string, name: string) => `/api/officer/photos/${dir}/${name}`;
