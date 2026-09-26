import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter(): nodemailer.Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

export type MailResult =
  /** The SMTP server accepted the message for delivery. */
  | { ok: true }
  /** No SMTP credentials are configured — nothing was sent. */
  | { ok: false; reason: "not_configured" }
  /** SMTP is configured but the submission failed. */
  | { ok: false; reason: "send_failed"; detail: string };

/**
 * Submits a message and reports honestly whether the server accepted it.
 *
 * Callers must not tell the user "we sent you an email" unless this returns
 * `{ ok: true }`. Acceptance by the SMTP server is not the same as delivery to
 * the inbox, but it is the strongest signal available at this point.
 */
export async function sendMail(to: string, subject: string, html: string): Promise<MailResult> {
  const t = getTransporter();
  if (!t) {
    console.warn(`[mailer] SMTP is not configured; no email sent to ${to} (${subject})`);
    return { ok: false, reason: "not_configured" };
  }
  try {
    const info = await t.sendMail({
      from:
        process.env.SMTP_FROM ||
        `"District Collectorate - Chennai" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    // nodemailer reports per-recipient rejections without throwing.
    if (info.rejected && info.rejected.length > 0) {
      const detail = `recipient rejected by SMTP server: ${info.rejected.join(", ")}`;
      console.error(`[mailer] ${detail}`);
      return { ok: false, reason: "send_failed", detail };
    }
    if (info.accepted && info.accepted.length === 0) {
      const detail = "SMTP server accepted no recipients";
      console.error(`[mailer] ${detail}`);
      return { ok: false, reason: "send_failed", detail };
    }
    return { ok: true };
  } catch (err) {
    // Never log the message body — it carries the verification code.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[mailer] Failed to send "${subject}" to ${to}: ${detail}`);
    return { ok: false, reason: "send_failed", detail };
  }
}

const SHELL = (title: string, body: string) => `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
    <h2 style="color: #0B3D91; margin-bottom: 4px;">District Collectorate &ndash; Chennai</h2>
    <p style="color: #666; font-size: 12px; margin-top: 0;">Public Grievance Redressal Portal</p>
    <h3 style="color: #111;">${title}</h3>
    ${body}
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 20px 0;" />
    <p style="color: #666; font-size: 12px;">
      This is an automated message. Please do not reply to it.
    </p>
  </div>
`;

const CODE_BLOCK = (otp: string) => `
  <p style="font-size: 30px; font-weight: bold; letter-spacing: 6px; color: #0B3D91; margin: 16px 0;">
    ${otp}
  </p>
`;

export function otpEmailHtml(otp: string, purposeLabel: string): string {
  return SHELL(
    "Your one-time password",
    `<p>Your OTP for ${purposeLabel} is:</p>
     ${CODE_BLOCK(otp)}
     <p>It is valid for 10 minutes. Do not share it with anyone.</p>
     <p style="color: #666; font-size: 12px;">
       If you did not request this, you can safely ignore this email.
     </p>`
  );
}

