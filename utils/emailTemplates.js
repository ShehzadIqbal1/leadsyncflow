function safeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function buildForgotPasswordEmailHtml(options) {
  const name = safeString(options.name) || "User";
  const resetUrl = safeString(options.resetUrl);
  const year = new Date().getFullYear();

  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Password Reset</title>
</head>

<body style="margin:0;padding:0;background-color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 0;">
<tr>
<td align="center">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

<tr>
<td style="background:#111827;padding:24px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:24px;">
LeadSyncFlow
</h1>
</td>
</tr>

<tr>
<td style="padding:32px;">

<h2 style="margin:0 0 16px;font-size:22px;color:#111827;">
Reset your password
</h2>

<p style="margin:0 0 16px;font-size:16px;color:#374151;">
Hello ${name},
</p>

<p style="margin:0 0 16px;font-size:16px;color:#374151;">
We received a request to reset your password for your LeadSyncFlow account.
Click the button below to set a new password.
</p>

<p style="text-align:center;margin:28px 0;">
<a href="${resetUrl}"
style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:600;">
Reset Password
</a>
</p>

<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">
This link will expire in <strong>30 minutes</strong>.
</p>

<p style="margin:0 0 10px;font-size:14px;color:#6b7280;">
If the button above does not work, copy and paste this link into your browser:
</p>

<p style="word-break:break-all;font-size:14px;color:#2563eb;margin:0 0 24px;">
${resetUrl}
</p>

<p style="margin:0;font-size:14px;color:#6b7280;">
If you did not request this password reset, you can safely ignore this email.
</p>

</td>
</tr>

<tr>
<td style="padding:20px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;font-size:12px;color:#9ca3af;">
© ${year} Global Digit Solutions. All rights reserved.
</p>
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
}

module.exports = {
  buildForgotPasswordEmailHtml,
};
