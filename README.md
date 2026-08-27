# Brain Stroke Classification using Machine Learning

Production-oriented full-stack reference application for tabular brain-stroke risk classification.

## Stack

- Frontend: React 18 + TypeScript + Vite + Tailwind CSS + Framer Motion + React Router + Lucide React
- Backend: Python Flask + Flask-JWT-Extended + Flask-CORS + SQLAlchemy + scikit-learn
- Model: scikit-learn preprocessing pipeline + RandomForestClassifier
- Database: SQLite by default; PostgreSQL-compatible through `DATABASE_URL`
- Authentication: JWT access tokens with role-based routing
- Scope: tabular demographic/clinical inputs only; no CT/MRI/image processing

## Project structure

```text
brain-stroke-classification/
├── backend/
│   ├── app.py
│   ├── config.py
│   ├── extensions.py
│   ├── models.py
│   ├── schemas.py
│   ├── auth.py
│   ├── ml/
│   │   ├── pipeline.py
│   │   ├── train.py
│   │   └── artifacts/
│   ├── requirements.txt
│   ├── .env.example
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   └── .env.example
└── README.md
```

## 1. Backend

Python 3.11/3.12 is recommended.

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
python -m ml.train
python run.py
```

The API starts at `http://127.0.0.1:5000`.

The training command creates a reproducible demo training set from the same clinical feature schema when a public dataset is not supplied. For research/deployment, replace the generated training data with a clinically validated dataset and perform external validation before using predictions for clinical decisions.

## 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Password reset email delivery

The forgot-password screen now lets a registered user choose either a secure email reset link or a one-time password (OTP). The OTP is 6 digits, expires after 10 minutes, and can be used only once. Reset links expire after 30 minutes and are also single-use.

Configure SMTP in `backend/.env` before using either option:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-smtp-app-password
SMTP_USE_TLS=true
MAIL_FROM=your-email@example.com
```

For Gmail, use an App Password rather than your normal account password. The application no longer displays a development reset URL on the forgot-password screen; reset instructions are delivered to the registered email address. The recipient is selected from the registered user record, so different users can request resets without changing the SMTP settings.

## Google sign-in

Set the Google Web OAuth client ID in `backend/.env`:

```env
GOOGLE_CLIENT_ID=your-google-web-client-id
```

The login page reads this public client ID from the backend and renders the Google sign-in button. Add `http://localhost:5173` (and your deployed frontend origin when applicable) to the OAuth client's authorized JavaScript origins in Google Cloud Console. No Google client secret belongs in the frontend.

## Default admin

For local development only:

- Email: `admin@stroke.local`
- Password: `Admin@12345`

Change these credentials before deployment. The backend seeds this account when the database is initialized.

## API

### Authentication

`POST /api/auth/register`

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "StrongPass@123"
}
```

`POST /api/auth/login`

```json
{
  "email": "jane@example.com",
  "password": "StrongPass@123"
}
```

`POST /api/auth/admin-login`

Uses the same shape and requires an administrator account.

### Prediction

`POST /api/predict`

Requires:

`Authorization: Bearer <access_token>`

Body:

```json
{
  "age": 67,
  "gender": "Male",
  "hypertension": 1,
  "heart_disease": 1,
  "ever_married": "Yes",
  "work_type": "Private",
  "residence_type": "Urban",
  "avg_glucose_level": 180,
  "bmi": 31.2,
  "smoking_status": "formerly smoked"
}
```

The response contains:

- `prediction`
- `risk_level`
- `stroke_probability`
- `no_stroke_probability`
- `risk_breakdown`
- `recommendations`

## Production hardening

Before deployment:

1. Set a strong `JWT_SECRET_KEY`.
2. Use PostgreSQL or another managed relational database.
3. Put Flask behind Gunicorn and a TLS-terminating reverse proxy.
4. Restrict CORS to the deployed frontend origin.
5. Store secrets in a secret manager.
6. Add rate limiting, audit logging, monitoring, backups, and centralized error tracking.
7. Replace the demo model with a validated model and document dataset provenance, calibration, subgroup performance, and operating thresholds.
8. Do not interpret the prediction as a medical diagnosis. The UI explicitly presents the result as a risk-estimation aid.

## Test

Backend:

```bash
cd backend
pytest
```

Frontend:

```bash
cd frontend
npm run build
```

## Latest user dashboard enhancements

- Added a protected `/dashboard` for registered users.
- Added user profile details with secure name/email update endpoint.
- Added dashboard metrics for total assessments, high-risk results, and average stroke probability.
- Added latest prediction visualization and animated prediction-history risk trend graph.
- After a successful assessment, users are taken to the dashboard so the newly calculated prediction is immediately visible.
- The detailed `/results` page now includes an animated probability comparison graph.
- Existing Framer Motion animations and NeuroRisk AI visual language are preserved; additions use subtle entrance/progress animations only.

### New user endpoints

- `GET /api/user/dashboard`
- `PUT /api/user/profile`


## Password reset email setup

The backend always loads `backend/.env` directly, so SMTP settings work even when the server is started from another directory. Before testing password reset, fill these values in `backend/.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-gmail-address@gmail.com
SMTP_PASSWORD=your-16-character-google-app-password
SMTP_USE_TLS=true
MAIL_FROM=your-gmail-address@gmail.com
```

**Important:** `SMTP_USERNAME` and `SMTP_PASSWORD` belong to the application's sender mailbox. Do not replace them with the newly registered patient's email. When a patient registers, their email is stored in the `User` table. If that patient later signs out and requests Forgot password, the backend looks up that exact registered email and sends the reset link/OTP to that address automatically. `MAIL_FROM` may be left empty; the backend will use `SMTP_USERNAME`. Restart the backend after changing `.env`.
