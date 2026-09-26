import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { profileUpdateSchema } from "@/lib/validators";
import { RowDataPacket } from "mysql2";
import { maskAadhaar } from "@/lib/crypto";

const OPTIONAL_COMPLETENESS_FIELDS = [
  "last_name",
  "gender",
  "date_of_birth",
  "alternate_email",
  "door_no_and_street",
  "area",
  "locality",
  "pincode",
  "zone_id",
  "ward_number",
  "aadhaar_last4",
  "profile_photo"
];

function computeCompleteness(profile: Record<string, any> | null): number {
  if (!profile) return 0;
  const filled = OPTIONAL_COMPLETENESS_FIELDS.filter(
    (f) => profile[f] !== null && profile[f] !== undefined && profile[f] !== ""
  ).length;
  return Math.round((filled / OPTIONAL_COMPLETENESS_FIELDS.length) * 100);
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.role, u.department_id, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?`,
    [session.userId]
  );
  if (userRows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const user = userRows[0];

  const [profileRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM user_profiles WHERE user_id = ?",
    [session.userId]
  );
  const profile = profileRows.length > 0 ? profileRows[0] : null;

  let zoneName: string | null = null;
  if (profile?.zone_id) {
    const [zoneRows] = await pool.query<RowDataPacket[]>(
      "SELECT zone_name FROM zones WHERE id = ?",
      [profile.zone_id]
    );
    zoneName = zoneRows[0]?.zone_name || null;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      departmentName: user.department_name
    },
    profile: profile
      ? {
          firstName: profile.first_name,
          lastName: profile.last_name,
          gender: profile.gender,
          dateOfBirth: profile.date_of_birth,
          mobileNumber: profile.mobile_number,
          mobileVerified: !!profile.mobile_verified,
          alternateEmail: profile.alternate_email,
          doorNoAndStreet: profile.door_no_and_street,
          area: profile.area,
          locality: profile.locality,
          pincode: profile.pincode,
          zoneId: profile.zone_id,
          zoneName,
          wardNumber: profile.ward_number,
          aadhaarMasked: maskAadhaar(profile.aadhaar_last4),
          profilePhoto: profile.profile_photo
        }
      : null,
    completeness: computeCompleteness(profile)
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const data = parsed.data;

  // Validate ward number falls within the selected zone's real range.
  if (data.zoneId && data.wardNumber) {
    const [zoneRows] = await pool.query<RowDataPacket[]>(
      "SELECT ward_start, ward_end FROM zones WHERE id = ?",
      [data.zoneId]
    );
    if (zoneRows.length === 0) {
      return NextResponse.json({ error: "Invalid zone selected." }, { status: 400 });
    }
    const { ward_start, ward_end } = zoneRows[0];
    if (data.wardNumber < ward_start || data.wardNumber > ward_end) {
      return NextResponse.json(
        { error: `Ward number must be between ${ward_start} and ${ward_end} for the selected zone.` },
        { status: 400 }
      );
    }
  }

  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM user_profiles WHERE user_id = ?",
    [session.userId]
  );

  const fields = {
    first_name: data.firstName,
    last_name: data.lastName || null,
    gender: data.gender || null,
    date_of_birth: data.dateOfBirth || null,
    alternate_email: data.alternateEmail || null,
    door_no_and_street: data.doorNoAndStreet || null,
    area: data.area || null,
    locality: data.locality || null,
    pincode: data.pincode || null,
    zone_id: data.zoneId || null,
    ward_number: data.wardNumber || null,
    mobile_number: data.mobileNumber || null
  };

  if (existing.length === 0) {
    await pool.query(
      `INSERT INTO user_profiles
        (user_id, first_name, last_name, gender, date_of_birth, alternate_email,
         door_no_and_street, area, locality, pincode, zone_id, ward_number,
         mobile_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.userId,
        fields.first_name,
        fields.last_name,
        fields.gender,
        fields.date_of_birth,
        fields.alternate_email,
        fields.door_no_and_street,
        fields.area,
        fields.locality,
        fields.pincode,
        fields.zone_id,
        fields.ward_number,
        fields.mobile_number
      ]
    );
  } else {
    await pool.query(
      `UPDATE user_profiles SET
        first_name = ?, last_name = ?, gender = ?, date_of_birth = ?, alternate_email = ?,
        door_no_and_street = ?, area = ?, locality = ?, pincode = ?, zone_id = ?, ward_number = ?,
        mobile_number = COALESCE(?, mobile_number)
       WHERE user_id = ?`,
      [
        fields.first_name,
        fields.last_name,
        fields.gender,
        fields.date_of_birth,
        fields.alternate_email,
        fields.door_no_and_street,
        fields.area,
        fields.locality,
        fields.pincode,
        fields.zone_id,
        fields.ward_number,
        fields.mobile_number,
        session.userId
      ]
    );
  }

  // Aadhaar is handled separately below (encrypted at rest) so a blank
  // submission doesn't wipe out a previously saved number.
  if (data.aadhaarNumber) {
    const { encryptAadhaar } = await import("@/lib/crypto");
    const encrypted = encryptAadhaar(data.aadhaarNumber);
    const last4 = data.aadhaarNumber.slice(-4);
    await pool.query(
      "UPDATE user_profiles SET aadhaar_number_encrypted = ?, aadhaar_last4 = ? WHERE user_id = ?",
      [encrypted, last4, session.userId]
    );
  }

  return NextResponse.json({ message: "Profile updated successfully." });
}
