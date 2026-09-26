import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import pool from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { RowDataPacket } from "mysql2";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPG and PNG images are allowed." }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File must be 2MB or smaller." }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "profile");
  await mkdir(uploadDir, { recursive: true });

  const ext = file.type === "image/png" ? "png" : "jpg";
  const filename = `user-${session.userId}-${Date.now()}.${ext}`;
  const filePath = path.join(uploadDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const publicPath = `/uploads/profile/${filename}`;

  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM user_profiles WHERE user_id = ?",
    [session.userId]
  );
  if (existing.length === 0) {
    await pool.query(
      "INSERT INTO user_profiles (user_id, profile_photo) VALUES (?, ?)",
      [session.userId, publicPath]
    );
  } else {
    await pool.query("UPDATE user_profiles SET profile_photo = ? WHERE user_id = ?", [
      publicPath,
      session.userId
    ]);
  }

  return NextResponse.json({ message: "Photo updated.", profilePhoto: publicPath });
}
