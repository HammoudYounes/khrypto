# Forgot Password — Implementation Plan

## Overview

Implement a real email-based password reset flow. The "Forgot Password?" button already exists in the login UI (currently shows a placeholder alert). Users already have their email stored in MongoDB (`mail` field).

---

## User Flow

1. User clicks "Forgot Password?" → email input form appears (same page, same auth panel)
2. User enters their email → `POST /api/auth/forgot-password`
3. Backend generates a one-time token, saves it to MongoDB with 30-min expiry, sends reset email
4. User clicks the link in the email → lands on `authPage/index.html?reset=<token>`
5. Page detects the query param → shows "reset password" form
6. User submits new password → `POST /api/auth/reset-password`
7. Backend validates token, updates password, deletes token
8. User redirected to login

---

## Architecture Notes

- **No gateway changes needed** — `/api/auth/*` is already proxied to the auth service
- **Microservice**: Pure Node.js `http` module (no Express)
- **Auth service**: port 8003
- **MongoDB**: `khrypto` db, `users` collection (`mail` field)
- **Frontend**: `services/files/front/authPage/` — hidden panels toggled by JS (same pattern as login/register toggle)

---

## Files to Modify

| File | What changes |
|------|-------------|
| `services/auth/index.js` | Add 2 new endpoints + nodemailer setup |
| `services/auth/package.json` | Add `nodemailer` dependency |
| `services/files/front/authPage/auth.js` | Replace placeholder alert, add form handlers, detect `?reset=` on page load |
| `services/files/front/authPage/index.html` | Add 2 hidden form panels (forgot + reset) |
| `.env` | Add SMTP credentials |
| `docker-compose.yml` | Pass SMTP env vars to auth container |

---

## Backend: New MongoDB Collection `password_resets`

```js
{
  userId: ObjectId,
  token: string,       // crypto.randomBytes(32).toString('hex')
  expiresAt: Date,     // 30 minutes from creation
  createdAt: Date
}
```

Add a **TTL index** on `expiresAt` so expired tokens auto-delete from MongoDB.

---

## Backend: New Endpoints

### `POST /api/auth/forgot-password`

```
Body: { email }
```

- Find user by `mail` in DB
- If found: generate token, save to `password_resets`, send reset email
- **Always return 200 with a generic message** (never reveal if email exists — prevents user enumeration)
- Reset link format: `https://yourdomain.com/authPage/index.html?reset=<token>`

### `POST /api/auth/reset-password`

```
Body: { token, newPassword }
```

- Find token in `password_resets`, check `expiresAt`
- If valid: hash new password with bcrypt, update user, **delete token** (single-use)
- Return 200 on success, 410 on expired/invalid

---

## Email Provider Options

### Option 1: Ethereal (local dev / testing)

Nodemailer's built-in fake SMTP. Zero setup — auto-creates a test account. Instead of sending real emails, it logs a **preview URL** to the console where you can see the email.

```js
const testAccount = await nodemailer.createTestAccount();
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: { user: testAccount.user, pass: testAccount.pass }
});
// After sending, log: nodemailer.getTestMessageUrl(info)
```

No `.env` changes needed for this. Good for development.

---

### Option 2: Gmail App Password (production on EC2 — recommended)

**No AWS configuration needed.** Works with a regular Google account.

**Setup steps:**
1. Go to your Google account → Security → enable 2-Factor Authentication
2. Go to Security → **App Passwords** → generate one (select "Mail")
3. You get a 16-character password like `abcd efgh ijkl mnop`
4. Add to `.env`:

```env
SMTP_USER=yourapp@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
RESET_BASE_URL=https://yourdomain.com
```

```js
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});
```

Limit: ~500 emails/day — more than enough for a school project.

> **Important**: Add `.env` to `.gitignore` if it isn't already — never commit email credentials.

---

### Option 3: AWS SES (avoid for now)

Requires verifying sender email/domain in the SES console, requesting production access (manual review, can take days), and dealing with sandbox restrictions. Overkill for a school project. Skip it.

---

## Security Checklist

| Concern | Solution |
|---------|----------|
| User enumeration | Always return the same generic 200 response regardless of whether email exists |
| Token brute force | Use `crypto.randomBytes(32).toString('hex')` — not guessable |
| Token reuse | Delete token immediately after successful use |
| Token expiry | 30-minute TTL via MongoDB TTL index |
| Email spam / DoS | Rate-limit `/forgot-password` (e.g. 3 requests per email per hour) |
| HTTPS | Use `https://` in reset links when on EC2 (handled at AWS level via ALB + ACM) |
| Password strength | Validate minimum length on both frontend and backend |

---

## Verification Steps

1. Start services, go to login page
2. Click "Forgot Password?" — email form appears on the same page
3. Enter a registered email → generic success message shown
4. **Dev (Ethereal)**: check console logs for preview URL → open it to see the email
5. **Prod (Gmail)**: check the inbox of the address you entered
6. Click reset link → `authPage/index.html?reset=<token>` → reset form appears
7. Enter new password → success → redirected to login
8. Login with new password → works
9. Try the same reset link again → 410 Gone (token deleted after use)
10. Try with expired token → 410 Gone

---

## Notes for Docker / EC2

In `docker-compose.yml`, pass the SMTP env vars to the auth container:

```yaml
auth:
  environment:
    - SMTP_USER=${SMTP_USER}
    - SMTP_PASS=${SMTP_PASS}
    - RESET_BASE_URL=${RESET_BASE_URL}
```

The `.env` file at the project root is automatically picked up by docker-compose.
