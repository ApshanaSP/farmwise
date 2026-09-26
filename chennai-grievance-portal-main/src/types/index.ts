export type UserRole = "collector" | "department_officer" | "citizen";

export interface JwtPayload {
  userId: number;
  email: string;
  role: UserRole;
  departmentId: number | null;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: UserRole;
  department_id: number | null;
  is_active: number;
  email_verified_at: string | null;
  email_verification_exempt: number;
  created_at: string;
  updated_at: string;
}

export type Gender = "Male" | "Female" | "Transgender";

export interface UserProfileRow {
  id: number;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  gender: Gender | null;
  date_of_birth: string | null;
  mobile_number: string | null;
  mobile_verified: number;
  alternate_email: string | null;
  door_no_and_street: string | null;
  area: string | null;
  locality: string | null;
  pincode: string | null;
  zone_id: number | null;
  ward_number: number | null;
  aadhaar_number_encrypted: string | null;
  aadhaar_last4: string | null;
  profile_photo: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZoneRow {
  id: number;
  zone_number: number;
  zone_name: string;
  ward_start: number;
  ward_end: number;
}

export interface LocalityRow {
  id: number;
  zone_id: number;
  name: string;
}

export interface StreetRow {
  id: number;
  locality_id: number;
  name: string;
}

export interface DepartmentRow {
  id: number;
  name: string;
  description: string;
}

export interface ComplaintTypeRow {
  id: number;
  name: string;
  department_id: number;
  is_frequent: number;
}

export type ComplaintStatus =
  | "Complaint Filed"
  | "Pending Approval"
  | "Approved by Department Officer"
  | "In Progress"
  | "Completed - Pending Collector Verification"
  | "Verified by Collector"
  | "Rejected";

export interface ComplaintRow {
  id: number;
  complaint_code: string;
  user_id: number | null;
  initials: string | null;
  first_name: string;
  last_name: string | null;
  gender: Gender;
  street_address: string;
  pincode: string;
  mobile_number: string;
  phone_number: string | null;
  email: string | null;
  zone_id: number;
  ward_number: number;
  locality_id: number;
  street_id: number;
  specific_location: string | null;
  latitude: string | null;
  longitude: string | null;
  department_id: number;
  complaint_type_id: number;
  title: string;
  description: string;
  media_path: string | null;
  is_anonymous: number;
  needs_manual_review: number;
  status: ComplaintStatus;
  rejected_stage: "Department Officer" | "Collector" | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplaintStatusHistoryRow {
  id: number;
  complaint_id: number;
  status: string;
  stage: string | null;
  remarks: string | null;
  changed_by: number | null;
  created_at: string;
}

export interface ApiError {
  error: string;
}
