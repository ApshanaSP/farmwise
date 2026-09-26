import { z } from "zod";

// ---------------------------------------------------------------------
// Password: min 8 chars, 1 upper, 1 lower, 1 number, 1 special, no spaces
// ---------------------------------------------------------------------
export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .refine((v) => !/\s/.test(v), "No spaces allowed")
  .refine((v) => /[A-Z]/.test(v), "At least one uppercase letter")
  .refine((v) => /[a-z]/.test(v), "At least one lowercase letter")
  .refine((v) => /[0-9]/.test(v), "At least one number")
  .refine((v) => /[^A-Za-z0-9]/.test(v), "At least one special character");

export interface PasswordRuleCheck {
  label: string;
  passed: boolean;
}

export function checkPasswordRules(password: string): PasswordRuleCheck[] {
  return [
    { label: "At least 8 characters", passed: password.length >= 8 },
    { label: "One uppercase letter", passed: /[A-Z]/.test(password) },
    { label: "One lowercase letter", passed: /[a-z]/.test(password) },
    { label: "One number", passed: /[0-9]/.test(password) },
    { label: "One special character", passed: /[^A-Za-z0-9]/.test(password) },
    { label: "No spaces", passed: password.length > 0 && !/\s/.test(password) }
  ];
}

export function passwordStrengthScore(password: string): number {
  const rules = checkPasswordRules(password);
  const passed = rules.filter((r) => r.passed).length;
  return Math.round((passed / rules.length) * 100);
}

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number");

export const pincodeSchema = z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit pincode");

export const otpSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit OTP");

export const aadhaarSchema = z
  .string()
  .trim()
  .regex(/^\d{12}$/, "Enter a valid 12-digit Aadhaar number");

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    // Captured once here so the complaint form never has to ask again.
    firstName: z
      .string({ required_error: "First name is required" })
      .trim()
      .min(1, "First name is required")
      .max(100),
    lastName: z.string().trim().max(100).optional().default(""),
    role: z.enum(["collector", "department_officer", "citizen"]),
    departmentId: z.number().int().positive().nullable().optional()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  })
  .refine((data) => (data.role === "department_officer" ? !!data.departmentId : true), {
    message: "Department is required for a Department Officer",
    path: ["departmentId"]
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required")
});

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema
});

export const forgotPasswordVerifySchema = z.object({
  email: emailSchema,
  otp: otpSchema
});

export const forgotPasswordResetSchema = z
  .object({
    email: emailSchema,
    otp: otpSchema,
    newPassword: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------
export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().max(100).optional().default(""),
  gender: z.enum(["Male", "Female", "Transgender"]).optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  alternateEmail: z.union([emailSchema, z.literal("")]).optional().nullable(),
  mobileNumber: z.union([mobileSchema, z.literal("")]).optional().nullable(),
  doorNoAndStreet: z.string().trim().max(255).optional().nullable(),
  area: z.string().trim().max(150).optional().nullable(),
  locality: z.string().trim().max(150).optional().nullable(),
  pincode: z.union([pincodeSchema, z.literal("")]).optional().nullable(),
  zoneId: z.number().int().positive().optional().nullable(),
  wardNumber: z.number().int().positive().optional().nullable(),
  aadhaarNumber: z.union([aadhaarSchema, z.literal("")]).optional().nullable()
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

// ---------------------------------------------------------------------
// Complaint
// ---------------------------------------------------------------------
export const complaintSubmitSchema = z
  .object({
    // --- complainant's own details -------------------------------------
    initials: z.string().trim().max(10).optional().default(""),
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().max(100).optional().default(""),
    gender: z.enum(["Male", "Female", "Transgender"]),
    streetAddress: z.string().trim().min(1, "Your address is required").max(255),
    // Mandatory: the department needs a way to reach the complainant.
    mobileNumber: mobileSchema,
    pincode: z.union([pincodeSchema, z.literal("")]).optional().nullable(),
    phoneNumber: z.string().trim().max(15).optional().nullable(),
    email: z.union([emailSchema, z.literal("")]).optional().nullable(),

    // --- where the problem is (verified GCC reference data) -------------
    zoneId: z.number().int().positive("Please select the zone"),
    // Derived server-side from the chosen street rather than picked: every
    // street already belongs to exactly one locality. Null for a manually
    // typed street, whose locality is genuinely unknown.
    gccLocalityId: z.number().int().positive().nullable().optional(),
    gccStreetId: z.number().int().positive().nullable().optional(),
    manualStreetName: z.string().trim().max(255).nullable().optional(),
    streetType: z.string().trim().max(60).nullable().optional(),

    wardNumber: z.number().int().min(1).max(200),
    wardSource: z.enum(["map_boundary", "user_selected"]).optional().default("user_selected"),
    locationPincode: z.union([pincodeSchema, z.literal("")]).nullable().optional(),

    specificLocation: z.string().trim().max(500).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),

    // --- what the problem is -------------------------------------------
    complaintSubtypeId: z.number().int().positive("Please select a complaint sub type"),
    // Free text for the "Other" type; the classifier routes it to a department.
    otherDescription: z.string().trim().max(400).nullable().optional(),

    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().min(1, "Details are required").max(400),
    mediaPath: z.string().trim().optional().nullable(),
    isAnonymous: z.boolean().optional().default(false)
  })
  .refine(
    (d) => Boolean(d.gccStreetId) || Boolean(d.manualStreetName && d.manualStreetName.length > 0),
    {
      message: "Select a street from the list, or enter one manually",
      path: ["gccStreetId"]
    }
  )
  .refine((d) => !(d.gccStreetId && d.manualStreetName), {
    // Exactly one of the two, so the stored street is never ambiguous.
    message: "Provide either a listed street or a manually entered one, not both",
    path: ["manualStreetName"]
  });
