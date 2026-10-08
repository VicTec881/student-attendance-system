# Student Attendance Management System

A web application that helps a school or college manage **student attendance** digitally. Administrators and teachers register students, mark daily attendance, search and filter records, and generate reports that can be exported to Excel or PDF. Students log in to see their own attendance, history and percentage.

Built with Node.js, Express and MongoDB, using the **MVC** (Model-View-Controller) pattern and a plain HTML, CSS and JavaScript frontend.

---

## Table of contents

1. [Features](#features)
2. [Technology stack](#technology-stack)
3. [Project structure](#project-structure)
4. [Getting started (local)](#getting-started-local)
5. [Environment variables](#environment-variables)
6. [Pages](#pages)
7. [Business rules](#business-rules)
8. [API overview](#api-overview)
9. [Security](#security)
10. [Deploying for free (Render + MongoDB Atlas)](#deploying-for-free-render--mongodb-atlas)
11. [Troubleshooting](#troubleshooting)
12. [Maintenance](#maintenance)
13. [License](#license)

---

## Features

### Administrator
- Register and manage **teacher** and **student login accounts** (view, edit, activate or deactivate, delete)
- See each account's last password change and last update time (passwords and hashes are never displayed)
- Add, view, edit and delete students (search, filter, sort and paginate)
- Mark attendance, edit a record's status, delete records
- Search and filter attendance records
- Dashboard with totals, today's attendance, overall percentage, a 7-day chart and recent records
- Daily, weekly, monthly, class and student reports with **Excel** and **PDF** export
- Report history

### Teacher
- Add and view students
- Mark attendance for a class, date and session
- Edit the attendance records they marked
- View and filter attendance records
- Generate and export reports

### Student
- Log in and view their own profile and student details
- View attendance history, present, absent and leave days, and attendance percentage
- Warning when attendance falls below 75%
- Export their own attendance report to Excel or PDF

### Everyone
- Change own password (current password required, strong password enforced)
- Edit own name and phone number
- Responsive layout (desktop, tablet and phone), keyboard-friendly, accessible forms

---

## Technology stack

| Area | Technology |
|---|---|
| Frontend | HTML5, CSS3, JavaScript (no framework) |
| Backend | Node.js, Express 5 |
| Database | MongoDB (Mongoose) |
| Authentication | JWT (JSON Web Tokens) |
| Password hashing | bcrypt.js |
| Reports | ExcelJS (Excel), PDFKit (PDF) |
| Security headers | Helmet |
| Architecture | MVC |

---

## Project structure

```
student-attendance-system/
├── config/
│   └── db.js                      MongoDB connection
├── controllers/                   Business logic
│   ├── attendanceController.js
│   ├── authController.js
│   ├── dashboardController.js
│   ├── reportController.js
│   ├── studentController.js
│   └── userController.js
├── middleware/
│   ├── authMiddleware.js          Verifies the JWT
│   ├── roleMiddleware.js          requireRole('admin', 'teacher', ...)
│   └── errorMiddleware.js         Centralized, safe error responses
├── models/                        MongoDB schemas
│   ├── Attendance.js
│   ├── Report.js
│   ├── Student.js
│   └── User.js
├── routes/                        URL to controller mapping
│   ├── attendanceRoutes.js
│   ├── authRoutes.js
│   ├── dashboardRoutes.js
│   ├── reportRoutes.js
│   ├── studentRoutes.js
│   ├── userRoutes.js
│   └── viewRoutes.js              Serves the HTML pages
├── utils/
│   ├── attendanceStats.js         Percentage and per-student calculations
│   └── reportExporters.js         Excel and PDF generation
├── views/                         HTML pages
│   ├── login.html  dashboard.html  students.html  attendance.html
│   └── records.html  reports.html  profile.html  teachers.html
├── public/
│   ├── css/style.css              One shared stylesheet
│   └── js/                        Browser scripts (one per page, plus shared helpers)
├── app.js                         Express app (middleware and routes)
├── server.js                      Starts the server after the database connects
├── seedAdmin.js                   Creates the first administrator
├── package.json
└── .env                           Local secrets (never committed)
```

**MVC in this project:** models define and validate data, controllers hold the logic, routes map URLs to controllers, middleware handles authentication, roles and errors, and the HTML, CSS and browser scripts are the view. The browser never touches the database. It only calls the `/api/...` endpoints.

---

## Getting started (local)

### Prerequisites
- [Node.js](https://nodejs.org/) 20 or newer
- A MongoDB database: a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster, or MongoDB installed locally
- [Git](https://git-scm.com/) (only needed to deploy)

### 1. Install dependencies
```bash
npm install
```

### 2. Create the `.env` file
Create a file named `.env` in the project root:

```env
PORT=5000
MONGO_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/student_attendance?appName=StudentAttendance
JWT_SECRET=replace_with_a_long_random_string
JWT_EXPIRES_IN=1d
NODE_ENV=development
```

Generate a strong secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

If your database password contains special characters (such as `@` or `#`), use a password with only letters and numbers, or URL-encode it.

### 3. Create the first administrator
Registration is admin-only, so the first admin is created with a script. Temporarily add these lines to `.env`:

```env
ADMIN_NAME=System Administrator
ADMIN_EMAIL=admin@school.com
ADMIN_PASSWORD=ChooseAStrong1Password
```

Then run:
```bash
node seedAdmin.js
```

**Afterwards, delete the `ADMIN_PASSWORD` line from `.env`.** The password needs at least 8 characters with an uppercase letter, a lowercase letter and a number.

### 4. Start the app
```bash
npm run dev      # development, restarts automatically when files change
npm start        # production
```

Open <http://localhost:5000>. You will be redirected to the login page. Log in as the admin, then:

1. Go to **Teachers** and create teacher accounts.
2. Go to **Students** and add students.
3. Go to **Teachers, Student accounts** and create logins for students.
4. Teachers use **Mark Attendance**, and everyone can view their allowed records and reports.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB connection string, including the database name |
| `JWT_SECRET` | Yes | Long random secret used to sign login tokens. Keep it private |
| `JWT_EXPIRES_IN` | No | Token lifetime. Default `1d` |
| `PORT` | No | Port to listen on. Default `5000`. Hosting platforms set this automatically |
| `NODE_ENV` | No | `development` or `production`. Stack traces are only logged in development |
| `TZ` | Recommended | The school's time zone, for example `Africa/Nairobi`. "Today" and "future date" checks use the server's calendar day |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Only for `seedAdmin.js` | Details of the first administrator |

---

## Pages

| URL | Who | Purpose |
|---|---|---|
| `/login` | Everyone | Sign in |
| `/dashboard` | Everyone | Role-specific dashboard |
| `/students` | Admin, Teacher | Manage students |
| `/attendance` | Admin, Teacher | Mark attendance |
| `/records` | Everyone | Attendance records (students see only their own, as "My Attendance") |
| `/reports` | Admin, Teacher | Generate and export reports |
| `/teachers` | Admin | Manage teacher, student and administrator accounts |
| `/profile` | Everyone | Personal information and change password |

---

## Business rules

- **Statuses:** Present, Absent, Leave.
- **Attendance percentage** = Present / (Present + Absent + Leave) x 100, rounded to one decimal place. It is 0 when there are no records. Values below 75% are highlighted.
- **No duplicates:** one record per student, date and session (Full Day, Morning, Afternoon, Evening). This is enforced by the server and by a unique database index.
- Attendance can only be marked for **active students** who belong to the selected class and course, and **not for future dates**.
- Only a record's **status** can be edited. An administrator can edit any record, and a teacher can edit records they marked. Only administrators can delete records.
- A **Student ID cannot be changed** after creation. Deleting a student also deletes their attendance records and login account, so set them to **Inactive** to keep the history.
- **Passwords** need at least 8 characters with an uppercase letter, a lowercase letter and a number. They are hashed with bcrypt, and users can only change their own. Changing a password signs out other sessions.
- **Weeks** in weekly reports run Monday to Sunday.
- A student can only ever see their own data. This is checked on the server for every request.

---

## API overview

All routes except login and the health check require a valid token: `Authorization: Bearer <token>`.

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/health` | Public | Health check |
| `POST /api/auth/login` | Public | Log in |
| `POST /api/auth/logout` | Logged in | Log out |
| `POST /api/auth/register` | Admin | Create a user |
| `GET, PUT /api/auth/profile` | Logged in | Read or update own profile |
| `PUT /api/auth/change-password` | Logged in | Change own password |
| `GET /api/users`, `GET, PUT, DELETE /api/users/:id` | Admin | Manage accounts |
| `GET, POST /api/students` | Admin, Teacher | List or add students |
| `GET /api/students/:id` | Admin, Teacher, the student (own) | View a student |
| `PUT, DELETE /api/students/:id` | Admin | Edit or delete a student |
| `GET /api/attendance/sheet` | Admin, Teacher | Load a class list for marking |
| `GET /api/attendance/summary` | Logged in (students: own) | Per-student totals and percentage |
| `GET /api/attendance`, `GET /api/attendance/:id` | Logged in (students: own) | Records with search, filters and pagination |
| `POST /api/attendance` | Admin, Teacher | Save attendance for a class |
| `PUT /api/attendance/:id` | Admin, Teacher (own records) | Change a record's status |
| `DELETE /api/attendance/:id` | Admin | Delete a record |
| `GET /api/dashboard` | Logged in | Role-specific dashboard data |
| `GET /api/reports` | Admin, Teacher | Report history |
| `GET /api/reports/daily`, `/weekly`, `/monthly`, `/class/:className` | Admin, Teacher | Reports |
| `GET /api/reports/student/:id` | Admin, Teacher, the student (own) | Student report |
| `GET /api/reports/export/excel`, `/export/pdf` | Admin, Teacher, the student (own report) | Download a report |

Errors use appropriate HTTP status codes (400, 401, 403, 404, 409, 422, 500) with a short, safe message. Stack traces, secrets and connection strings are never returned.

---

## Security

- Passwords are hashed with bcrypt and are never returned by the API or shown anywhere in the interface.
- Login uses JWT. The user is always identified from the token, never from a value sent by the page.
- Role checks run on the server for every request, so hiding a button in the page is never the only protection.
- Login errors do not reveal whether an email exists.
- Inputs are validated and escaped before being displayed.
- Helmet adds standard security headers.
- Keep `.env` out of Git (it is listed in `.gitignore`) and use a different `JWT_SECRET` in production.

---

## Deploying for free (Render + MongoDB Atlas)

The app is a single Node service that also serves its pages, so it can be hosted on one free web service. This guide uses **Render** for the app and **MongoDB Atlas** for the database.

1. **Prepare the code.** Make sure `.env` is not tracked by Git (`git ls-files .env` should print nothing), and that file names match exactly, including capital letters (Linux hosting is case-sensitive).
2. **Push to GitHub.**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/student-attendance-system.git
   git push -u origin main
   ```
3. **MongoDB Atlas.** In Network Access, allow `0.0.0.0/0` (free hosting does not give the app a fixed IP). Use a strong database password.
4. **Render.** Create a **Web Service** from the GitHub repository and use:

   | Setting | Value |
   |---|---|
   | Language | Node |
   | Branch | `main` |
   | Build command | `npm install` |
   | Start command | `npm start` |
   | Instance type | Free |
   | Health check path (optional) | `/api/health` |

5. **Environment variables** (Render, Environment section). Do not set `PORT`, because Render sets it.

   | Key | Value |
   |---|---|
   | `MONGO_URI` | Your Atlas connection string, including the database name |
   | `JWT_SECRET` | A new long random string (not the one used locally) |
   | `JWT_EXPIRES_IN` | `1d` |
   | `NODE_ENV` | `production` |
   | `TZ` | Your school's time zone, for example `Africa/Nairobi` |

6. Deploy, wait for the log to show `MongoDB connected` and `Server running`, then open the `.onrender.com` address Render gives you.

Every push to the connected branch redeploys the app automatically by default.

### Free tier behaviour
- A free Render web service goes to sleep after 15 minutes without traffic. The first visit afterwards can take around a minute to load.
- Free instance hours are limited per month and shared by all free services in the Render workspace. Check Render's current terms at <https://render.com/docs/free>.
- A free Atlas M0 cluster has 512 MB of storage, no time limit, and is paused after a long period with no connections. Resume it from the Atlas dashboard if that happens.
- Free-tier terms can change, so check the provider pages before relying on them.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Server stops with "Unable to connect to the database" | `MONGO_URI` is correct, the password has no special characters, and Atlas Network Access allows your IP (or `0.0.0.0/0`) |
| "Cannot find module" on the host but not on your computer | A file or folder name has different capital letters than the `require` path |
| Page shows `The requested resource was not found.` | The matching `.html` file is missing from `views/` |
| Page looks unstyled | `public/css/style.css` is missing, or do a hard refresh (Ctrl + Shift + R) |
| Redirected to the login page with "session expired" | The token expired, or the password was changed. Log in again |
| Attendance "cannot be marked for a future date" around midnight | Set the `TZ` environment variable to your school's time zone |
| First page load is very slow on the free host | The service was asleep. Wait about a minute and refresh |

---

## Maintenance

- **Update the live site:** `git add .`, `git commit -m "describe the change"`, `git push`.
- **Backups:** free database clusters do not include automated backups. Export your data regularly, for example with `mongodump` or by exporting reports to Excel.
- **Passwords:** administrators cannot see or reset user passwords. Users change their own from the Profile page, so give new accounts a temporary password and ask users to change it at first login.
- **Cleaning test data:** if you used a `cleanup-test-data.js` script during development, delete it before going live.

---

## License

ISC
