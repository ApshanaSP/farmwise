"use client";

import { useEffect, useState, FormEvent } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";

interface Zone {
  id: number;
  zone_number: number;
  zone_name: string;
  ward_start: number;
  ward_end: number;
}

interface ProfileData {
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  mobileNumber: string | null;
  mobileVerified: boolean;
  alternateEmail: string | null;
  doorNoAndStreet: string | null;
  area: string | null;
  locality: string | null;
  pincode: string | null;
  zoneId: number | null;
  zoneName: string | null;
  wardNumber: number | null;
  aadhaarMasked: string;
  profilePhoto: string | null;
}

interface UserInfo {
  id: number;
  email: string;
  role: "collector" | "department_officer" | "citizen";
  departmentName: string | null;
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [completeness, setCompleteness] = useState(0);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit form state
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    gender: "",
    dateOfBirth: "",
    alternateEmail: "",
    doorNoAndStreet: "",
    area: "",
    locality: "",
    pincode: "",
    zoneId: "",
    wardNumber: "",
    aadhaarNumber: ""
  });

  // Mobile OTP re-verification state
  const [mobileEditing, setMobileEditing] = useState(false);
  const [newMobile, setNewMobile] = useState("");
  const [mobileOtp, setMobileOtp] = useState("");
  const [mobileOtpSent, setMobileOtpSent] = useState(false);
  const [mobileDevOtp, setMobileDevOtp] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [mobileSubmitting, setMobileSubmitting] = useState(false);

  // Change password state
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // Photo upload
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
    fetch("/api/locations/zones")
      .then((r) => r.json())
      .then((d) => setZones(d.zones || []));
  }, []);

  async function loadProfile() {
    setLoading(true);
    const res = await fetch("/api/profile");
    if (res.ok) {
      const data = await res.json();
      setUser(data.user);
      setProfile(data.profile);
      setCompleteness(data.completeness);
      if (data.profile) {
        setForm({
          firstName: data.profile.firstName || "",
          lastName: data.profile.lastName || "",
          gender: data.profile.gender || "",
          dateOfBirth: data.profile.dateOfBirth ? String(data.profile.dateOfBirth).slice(0, 10) : "",
          alternateEmail: data.profile.alternateEmail || "",
          doorNoAndStreet: data.profile.doorNoAndStreet || "",
          area: data.profile.area || "",
          locality: data.profile.locality || "",
          pincode: data.profile.pincode || "",
          zoneId: data.profile.zoneId ? String(data.profile.zoneId) : "",
          wardNumber: data.profile.wardNumber ? String(data.profile.wardNumber) : "",
          aadhaarNumber: ""
        });
      }
    }
    setLoading(false);
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          gender: form.gender || null,
          dateOfBirth: form.dateOfBirth || null,
          alternateEmail: form.alternateEmail || null,
          doorNoAndStreet: form.doorNoAndStreet || null,
          area: form.area || null,
          locality: form.locality || null,
          pincode: form.pincode || null,
          zoneId: form.zoneId ? Number(form.zoneId) : null,
          wardNumber: form.wardNumber ? Number(form.wardNumber) : null,
          aadhaarNumber: form.aadhaarNumber || null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save profile.");
        setSaving(false);
        return;
      }
      setSuccess("Profile updated successfully.");
      setEditing(false);
      await loadProfile();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function requestMobileOtp() {
    setMobileError(null);
    setMobileSubmitting(true);
    try {
      const res = await fetch("/api/profile/mobile-otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobileNumber: newMobile })
      });
      const data = await res.json();
      if (!res.ok) {
        setMobileError(data.error || "Failed to send OTP.");
        setMobileSubmitting(false);
        return;
      }
      setMobileOtpSent(true);
      if (data.devOtp) setMobileDevOtp(data.devOtp);
    } catch {
      setMobileError("Something went wrong. Please try again.");
    } finally {
      setMobileSubmitting(false);
    }
  }

  async function verifyMobileOtp() {
    setMobileError(null);
    setMobileSubmitting(true);
    try {
      const res = await fetch("/api/profile/mobile-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobileNumber: newMobile, otp: mobileOtp })
      });
      const data = await res.json();
      if (!res.ok) {
        setMobileError(data.error || "Failed to verify OTP.");
        setMobileSubmitting(false);
        return;
      }
      setMobileEditing(false);
      setMobileOtpSent(false);
      setNewMobile("");
      setMobileOtp("");
      setMobileDevOtp(null);
      await loadProfile();
    } catch {
      setMobileError("Something went wrong. Please try again.");
    } finally {
      setMobileSubmitting(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError("Passwords do not match.");
      return;
    }

    setPwSubmitting(true);
    try {
      const res = await fetch("/api/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pwForm)
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error || "Failed to change password.");
        setPwSubmitting(false);
        return;
      }
      setPwSuccess("Password changed successfully.");
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch {
      setPwError("Something went wrong. Please try again.");
    } finally {
      setPwSubmitting(false);
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch("/api/profile/photo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setPhotoError(data.error || "Failed to upload photo.");
        return;
      }
      await loadProfile();
    } catch {
      setPhotoError("Something went wrong. Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  }

  const selectedZone = zones.find((z) => String(z.id) === form.zoneId);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <Header userName={user?.email} />
        <main className="flex flex-1 items-center justify-center">
          <p className="text-gray-500">Loading profile...</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header userName={user?.email || undefined} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="mb-6 text-2xl font-bold text-navy-900">My Profile</h1>

        {/* Profile photo + completeness */}
        <div className="card mb-6 flex flex-col items-center gap-4 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            <img
              src={profile?.profilePhoto || "/default-avatar.svg"}
              alt="Profile photo"
              className="h-24 w-24 rounded-full border-2 border-navy-100 object-cover"
            />
            <label className="cursor-pointer text-xs font-semibold text-navy hover:underline">
              {photoUploading ? "Uploading..." : "Change photo"}
              <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handlePhotoChange} disabled={photoUploading} />
            </label>
            {photoError && <p className="form-error text-center">{photoError}</p>}
          </div>
          <div className="w-full flex-1">
            <p className="mb-1 flex justify-between text-sm font-medium text-gray-700">
              <span>Profile completeness</span>
              <span>{completeness}%</span>
            </p>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${completeness}%` }} />
            </div>
          </div>
        </div>

        {/* Read-only account info */}
        <div className="card mb-6">
          <h2 className="mb-4 text-lg font-semibold text-navy-900">Account Information</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">Login Email</dt>
              <dd className="font-medium text-gray-900">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Role</dt>
              <dd className="font-medium capitalize text-gray-900">{user?.role.replace("_", " ")}</dd>
            </div>
            {user?.role === "department_officer" && (
              <div>
                <dt className="text-sm text-gray-500">Department</dt>
                <dd className="font-medium text-gray-900">{user.departmentName}</dd>
              </div>
            )}
            {user?.role === "collector" && (
              <div>
                <dt className="text-sm text-gray-500">Designation</dt>
                <dd className="font-medium text-gray-900">District Collector, Chennai.</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-gray-500">Contact admin to change your role or email.</p>
        </div>

        {error && <div role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {success && <div role="status" className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-800">{success}</div>}

        {/* Editable personal details */}
        <div className="card mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-navy-900">Personal Details</h2>
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className="btn-secondary">
                Edit Profile
              </button>
            )}
          </div>

          {!editing ? (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First Name" value={profile?.firstName} />
              <Field label="Last Name" value={profile?.lastName} />
              <Field label="Gender" value={profile?.gender} />
              <Field label="Date of Birth" value={profile?.dateOfBirth ? String(profile.dateOfBirth).slice(0, 10) : null} />
              <Field label="Alternate Email" value={profile?.alternateEmail} />
              <Field label="Door No. & Street" value={profile?.doorNoAndStreet} />
              <Field label="Area" value={profile?.area} />
              <Field label="Locality" value={profile?.locality} />
              <Field label="Pincode" value={profile?.pincode} />
              <Field label="Zone" value={profile?.zoneName} />
              <Field label="Ward Number" value={profile?.wardNumber ? String(profile.wardNumber) : null} />
              <Field label="Aadhaar Number" value={profile?.aadhaarMasked || null} />
            </dl>
          ) : (
            <form onSubmit={handleSaveProfile} noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="firstName">First Name</label>
                  <input id="firstName" required className="form-input" value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="lastName">Last Name</label>
                  <input id="lastName" className="form-input" value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
                <div>
                  <span className="form-label">Gender</span>
                  <div className="flex gap-4 pt-1">
                    {["Male", "Female", "Transgender"].map((g) => (
                      <label key={g} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          name="gender"
                          value={g}
                          checked={form.gender === g}
                          onChange={(e) => setForm({ ...form, gender: e.target.value })}
                        />
                        {g}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label" htmlFor="dob">Date of Birth</label>
                  <input id="dob" type="date" className="form-input" value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="altEmail">Alternate Email</label>
                  <input id="altEmail" type="email" className="form-input" value={form.alternateEmail}
                    onChange={(e) => setForm({ ...form, alternateEmail: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="pincode">Pincode</label>
                  <input id="pincode" maxLength={6} className="form-input" value={form.pincode}
                    onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label" htmlFor="doorStreet">Door No. &amp; Street</label>
                  <input id="doorStreet" className="form-input" value={form.doorNoAndStreet}
                    onChange={(e) => setForm({ ...form, doorNoAndStreet: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="area">Area</label>
                  <input id="area" className="form-input" value={form.area}
                    onChange={(e) => setForm({ ...form, area: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="locality">Locality</label>
                  <input id="locality" className="form-input" value={form.locality}
                    onChange={(e) => setForm({ ...form, locality: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="zone">Zone</label>
                  <select id="zone" className="form-input" value={form.zoneId}
                    onChange={(e) => setForm({ ...form, zoneId: e.target.value, wardNumber: "" })}>
                    <option value="">Select zone</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>Zone {z.zone_number} &ndash; {z.zone_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="ward">
                    Ward Number {selectedZone && `(${selectedZone.ward_start}-${selectedZone.ward_end})`}
                  </label>
                  <input id="ward" type="number" className="form-input" value={form.wardNumber}
                    min={selectedZone?.ward_start} max={selectedZone?.ward_end}
                    onChange={(e) => setForm({ ...form, wardNumber: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label" htmlFor="aadhaar">
                    Aadhaar Number {profile?.aadhaarMasked && `(current: ${profile.aadhaarMasked})`}
                  </label>
                  <input id="aadhaar" maxLength={12} placeholder="12-digit Aadhaar (leave blank to keep unchanged)"
                    className="form-input" value={form.aadhaarNumber}
                    onChange={(e) => setForm({ ...form, aadhaarNumber: e.target.value.replace(/\D/g, "") })} />
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Mobile number + OTP re-verification */}
        <div className="card mb-6">
          <h2 className="mb-4 text-lg font-semibold text-navy-900">Mobile Number</h2>
          {!mobileEditing ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">
                  {profile?.mobileNumber || "Not set"}{" "}
                  {profile?.mobileNumber && (
                    <span className={`ml-1 text-xs font-semibold ${profile.mobileVerified ? "text-green-700" : "text-yellow-700"}`}>
                      {profile.mobileVerified ? "Verified" : "Not verified"}
                    </span>
                  )}
                </p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setMobileEditing(true)}>
                Change
              </button>
            </div>
          ) : (
            <div>
              {mobileError && <div role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{mobileError}</div>}
              {!mobileOtpSent ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="form-label" htmlFor="newMobile">New Mobile Number</label>
                    <input id="newMobile" maxLength={10} className="form-input" value={newMobile}
                      onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <button type="button" disabled={mobileSubmitting} onClick={requestMobileOtp} className="btn-primary">
                    {mobileSubmitting ? "Sending..." : "Send OTP"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setMobileEditing(false)}>Cancel</button>
                </div>
              ) : (
                <div>
                  {mobileDevOtp && (
                    <p className="mb-2 rounded bg-navy-50 p-2 font-mono text-sm font-bold text-navy-900">
                      [Dev mode] Your OTP: {mobileDevOtp}
                    </p>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label className="form-label" htmlFor="mobileOtp">Enter OTP sent to verify {newMobile}</label>
                      <input id="mobileOtp" maxLength={6} className="form-input" value={mobileOtp}
                        onChange={(e) => setMobileOtp(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <button type="button" disabled={mobileSubmitting} onClick={verifyMobileOtp} className="btn-primary">
                      {mobileSubmitting ? "Verifying..." : "Verify & Save"}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => { setMobileEditing(false); setMobileOtpSent(false); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Change password */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-navy-900">Change Password</h2>
          {pwError && <div role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{pwError}</div>}
          {pwSuccess && <div role="status" className="mb-3 rounded-md bg-green-50 p-3 text-sm text-green-800">{pwSuccess}</div>}
          <form onSubmit={handleChangePassword} noValidate>
            <div className="mb-4">
              <label className="form-label" htmlFor="currentPassword">Current Password</label>
              <input id="currentPassword" type="password" required className="form-input"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} />
            </div>
            <div className="mb-4">
              <label className="form-label" htmlFor="newPassword2">New Password</label>
              <input id="newPassword2" type="password" required className="form-input"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
              <PasswordStrengthMeter password={pwForm.newPassword} />
            </div>
            <div className="mb-6">
              <label className="form-label" htmlFor="confirmNewPassword">Confirm New Password</label>
              <input id="confirmNewPassword" type="password" required className="form-input"
                value={pwForm.confirmPassword}
                onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} />
            </div>
            <button type="submit" disabled={pwSubmitting} className="btn-primary">
              {pwSubmitting ? "Updating..." : "Change Password"}
            </button>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value || <span className="text-gray-400">Not provided</span>}</dd>
    </div>
  );
}
