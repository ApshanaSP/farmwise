import { NextRequest, NextResponse } from "next/server";
import pool, { withTransaction } from "@/lib/db";
import { getSessionFromCookies, getActiveSession } from "@/lib/auth";
import { complaintSubmitSchema } from "@/lib/validators";
import { generateUniqueComplaintCode } from "@/lib/complaint-code";
import { resolveWard } from "@/lib/wards";
import { classifyComplaint } from "@/lib/ai-classifier";
import { DEFAULT_FALLBACK_DEPARTMENT } from "@/lib/constants";
import { appendComplaintToDataset } from "@/lib/dataset/append";
import { RowDataPacket, ResultSetHeader } from "mysql2";

export async function POST(req: NextRequest) {
  try {
    const session = await getActiveSession();
    if (!session) {
      return NextResponse.json(
        { error: "Please sign in to file a complaint." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = complaintSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    // ---- Re-validate every location relationship server-side -------------
    // The client already enforces these, which is exactly why the server must
    // not trust them.
    const [zoneRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM zones WHERE id = ? LIMIT 1",
      [data.zoneId]
    );
    if (zoneRows.length === 0) {
      return NextResponse.json({ error: "Selected zone is not recognised." }, { status: 400 });
    }

    // Area and locality both come from the chosen street rather than the
    // client: a street belongs to exactly one locality, and that locality to
    // one area, so accepting either from the request would only create a way
    // for them to disagree.
    let localityId: number | null = null;
    let areaId: number | null = null;
    if (data.gccStreetId) {
      const [streetRows] = await pool.query<RowDataPacket[]>(
        `SELECT s.id, s.locality_id, l.area_id, a.zone_id
           FROM gcc_streets s
           JOIN gcc_localities l ON l.id = s.locality_id
           JOIN gcc_areas a ON a.id = l.area_id
          WHERE s.id = ? LIMIT 1`,
        [data.gccStreetId]
      );
      if (streetRows.length === 0) {
        return NextResponse.json({ error: "Selected street is not recognised." }, { status: 400 });
      }
      // A street whose area has no zone on record is accepted: the gap is in
      // our own area-to-zone derivation, not in the citizen's choice.
      const streetZone = streetRows[0].zone_id as number | null;
      if (streetZone !== null && streetZone !== data.zoneId) {
        return NextResponse.json(
          { error: "The selected street is not in the selected zone." },
          { status: 400 }
        );
      }
      localityId = streetRows[0].locality_id as number;
      areaId = streetRows[0].area_id as number;
    }

    // Ward must be a real GCC ward; its zone comes from the ward, not the client.
    const [wardRows] = await pool.query<RowDataPacket[]>(
      `SELECT zw.ward_number, zw.zone_id, z.zone_name
         FROM zone_wards zw JOIN zones z ON z.id = zw.zone_id
        WHERE zw.ward_number = ? LIMIT 1`,
      [data.wardNumber]
    );
    if (wardRows.length === 0) {
      return NextResponse.json({ error: "Selected ward is not a Greater Chennai Corporation ward." }, { status: 400 });
    }
    const zoneId = wardRows[0].zone_id as number;

    // If coordinates were supplied, confirm them against the boundary data and
    // record how the ward was actually established.
    let wardSource: "map_boundary" | "user_selected" = data.wardSource ?? "user_selected";
    if (data.latitude != null && data.longitude != null) {
      const lookup = resolveWard(data.latitude, data.longitude);
      if (lookup.status === "outside_boundary") {
        return NextResponse.json(
          {
            error:
              "The marked location is outside the Greater Chennai Corporation area, so this " +
              "complaint cannot be accepted here."
          },
          { status: 400 }
        );
      }
      if (lookup.status === "resolved") {
        if (lookup.wardNo !== data.wardNumber && !lookup.ambiguous) {
          // Trust the geometry over the submitted number.
          wardSource = "map_boundary";
          data.wardNumber = lookup.wardNo;
        } else if (lookup.wardNo === data.wardNumber) {
          wardSource = "map_boundary";
        }
      } else {
        // Boundary data unavailable — the citizen's choice stands, labelled as such.
        wardSource = "user_selected";
      }
    } else {
      wardSource = "user_selected";
    }

    const finalZoneId =
      data.wardNumber === (wardRows[0].ward_number as number)
        ? zoneId
        : (
            await pool.query<RowDataPacket[]>(
              "SELECT zone_id FROM zone_wards WHERE ward_number = ? LIMIT 1",
              [data.wardNumber]
            )
          )[0][0]?.zone_id ?? zoneId;

    // ---- Complaint type + department routing -----------------------------
    const [subRows] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.label, s.department_id, s.mapping_status, c.name AS category_name
         FROM complaint_subtypes s
         JOIN complaint_categories c ON c.id = s.category_id
        WHERE s.id = ? AND s.is_active = 1 LIMIT 1`,
      [data.complaintSubtypeId]
    );
    if (subRows.length === 0) {
      return NextResponse.json({ error: "Invalid complaint type." }, { status: 400 });
    }
    const subtype = subRows[0];

    let departmentId = subtype.department_id as number | null;
    let needsManualReview = subtype.mapping_status === "assumed";

    if (!departmentId) {
      // No fixed department for this type ("Other"). Route it from what the
      // citizen wrote, using OpenAI when configured and a keyword classifier
      // otherwise; either way a department is always chosen, and an officer
      // confirms it.
      const text = [data.otherDescription, data.title, data.description]
        .filter(Boolean)
        .join(". ");
      const classification = await classifyComplaint(text);
      needsManualReview = true;

      const [deptRows] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM departments WHERE name = ? LIMIT 1",
        [classification.department]
      );
      departmentId = deptRows.length > 0 ? (deptRows[0].id as number) : null;

      if (!departmentId) {
        const [fallback] = await pool.query<RowDataPacket[]>(
          "SELECT id FROM departments WHERE name = ? LIMIT 1",
          [DEFAULT_FALLBACK_DEPARTMENT]
        );
        departmentId = fallback.length > 0 ? (fallback[0].id as number) : null;
      }
      if (!departmentId) {
        return NextResponse.json(
          { error: "No department is configured to receive this complaint." },
          { status: 500 }
        );
      }
    }

    const complaintCode = await generateUniqueComplaintCode();

    const complaintId = await withTransaction(async (conn) => {
      const [insertResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO complaints (
          complaint_code, user_id, initials, first_name, last_name, gender,
          street_address, pincode, mobile_number, phone_number, email,
          zone_id, ward_number, ward_source,
          gcc_area_id, gcc_locality_id, gcc_street_id, manual_street_name, street_type,
          location_pincode, specific_location, latitude, longitude,
          department_id, complaint_subtype_id, title, description, media_path,
          is_anonymous, needs_manual_review, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Complaint Filed')`,
        [
          complaintCode,
          session.userId,
          data.initials || null,
          data.firstName,
          data.lastName || null,
          data.gender,
          data.streetAddress,
          data.pincode,
          data.mobileNumber || null,
          data.phoneNumber || null,
          data.email || null,
          finalZoneId,
          data.wardNumber,
          wardSource,
          areaId,
          localityId,
          data.gccStreetId ?? null,
          data.manualStreetName || null,
          data.streetType || null,
          data.locationPincode || null,
          data.specificLocation || null,
          data.latitude ?? null,
          data.longitude ?? null,
          departmentId,
          data.complaintSubtypeId,
          data.title,
          data.description,
          data.mediaPath || null,
          data.isAnonymous ? 1 : 0,
          needsManualReview ? 1 : 0
        ]
      );

      const newId = insertResult.insertId;
      await conn.query(
        `INSERT INTO complaint_status_history (complaint_id, status, stage, remarks, changed_by)
         VALUES (?, 'Complaint Filed', 'Citizen', ?, ?)`,
        [
          newId,
          needsManualReview
            ? "Complaint registered. Department routing pending officer review."
            : "Complaint registered by citizen.",
          session.userId
        ]
      );
      return newId;
    });

    // Keep the grievance dataset current. Fire-and-forget: a dataset problem
    // must never fail or slow down a citizen's filing.
    appendComplaintToDataset(complaintCode).catch((err) =>
      console.error("[dataset] could not append " + complaintCode + ":", err)
    );

    const [deptNameRows] = await pool.query<RowDataPacket[]>(
      "SELECT name FROM departments WHERE id = ?",
      [departmentId]
    );

    return NextResponse.json({
      message:
        "Your complaint has been registered in the Public Grievance Redressal Portal of GCC. " +
        "You can check the current status of your complaint using your Complaint Number.",
      complaintCode,
      complaintId,
      department: deptNameRows[0]?.name ?? null,
      departmentPending: needsManualReview,
      complaintType: subtype.label as string,
      complaintCategory: subtype.category_name as string,
      wardNumber: data.wardNumber,
      wardSource
    });
  } catch (err) {
    console.error("[api/complaints POST]", err);
    return NextResponse.json(
      { error: "Something went wrong while submitting your complaint. Please try again." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "citizen") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code")?.trim();
  const status = searchParams.get("status")?.trim();

  // LEFT JOINs throughout: complaints filed before the GCC reference data was
  // adopted carry complaint_type_id / locality_id instead, and must still list.
  let query = `
    SELECT c.id, c.complaint_code, c.title, c.status, c.rejected_stage, c.remarks,
           c.created_at, c.zone_id, c.ward_number, c.is_anonymous,
           d.name AS department_name,
           COALESCE(cs.label, ct.name) AS complaint_type_name,
           cc.name AS complaint_category_name,
           z.zone_name,
           COALESCE(gl.name, l.name) AS locality_name,
           ga.name AS area_name
    FROM complaints c
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN complaint_subtypes cs ON cs.id = c.complaint_subtype_id
    LEFT JOIN complaint_categories cc ON cc.id = cs.category_id
    LEFT JOIN complaint_types ct ON ct.id = c.complaint_type_id
    LEFT JOIN zones z ON z.id = c.zone_id
    LEFT JOIN gcc_localities gl ON gl.id = c.gcc_locality_id
    LEFT JOIN gcc_areas ga ON ga.id = c.gcc_area_id
    LEFT JOIN localities l ON l.id = c.locality_id
    WHERE c.user_id = ?`;
  const params: (string | number)[] = [session.userId];

  if (code) {
    query += " AND c.complaint_code LIKE ?";
    params.push(`%${code}%`);
  }
  if (status) {
    query += " AND c.status = ?";
    params.push(status);
  }

  query += " ORDER BY c.created_at DESC";

  const [rows] = await pool.query<RowDataPacket[]>(query, params);

  return NextResponse.json({ complaints: rows });
}
