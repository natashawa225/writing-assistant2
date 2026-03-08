This is an AI-assisted writing tool designed to help students improve the structure and clarity of argumentative essays.

The system analyzes essays and provides structured feedback on key argumentative elements such as claims, evidence, and rebuttals. Feedback is delivered through a staged interface that encourages writers to reflect on their reasoning before accessing direct corrections.

---

# Features

## Argument Structure Analysis

ReflectNote analyzes essays and identifies key argumentative elements, including:

- Claims
- Evidence
- Rebuttals

These elements are visualized in an interactive argument diagram to help writers understand the structure of their arguments.

---

## Multi-Level Feedback

Feedback is presented in multiple levels that progressively reveal more information.

### Level 1 — Location Cues

The interface highlights where potential issues occur in the argument structure, helping students identify areas that may need revision.

### Level 2 — Reflective Hints

Students receive indirect feedback and prompts designed to encourage reflection and self-revision.

### Level 3 — Direct Corrections

Students can optionally reveal direct suggestions along with explanations describing how the revision improves the argument.

---

## Interactive Argument Diagram

Argumentative elements are visualized in a diagram that allows writers to:

- Explore relationships between claims and evidence
- Identify structural weaknesses
- Access feedback for specific elements

---

## Revision Insights

After completing a writing session, the system generates a summary of revision patterns. This overview highlights how the essay evolved during the revision process and what types of changes were made.

---

# Technology Stack

- **Next.js** – Frontend framework
- **Supabase** – Database and session logging
- **OpenAI API** – Essay analysis and feedback generation
- **TypeScript** – Application logic

---

# Data Logging

The system records interaction events during a writing session to support application functionality and system evaluation. Logged events may include:

- Draft submissions
- Feedback interactions
- Essay edits
- Final submission

Each writing session is associated with a unique session ID.

---

# Setup

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Create a `.env.local` file:

```env
OPENAI_API_KEY=your_openai_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

---

## 3. Run the development server

```bash
npm run dev
```

Then open:

```
http://localhost:3000
```

---

# Project Structure

```
app/
  page.tsx                Main writing interface
  api/                    API routes

components/
  argument-diagram/       Visualization of argument structure
  feedback/               Feedback interface

lib/
  supabase.ts             Supabase client configuration
  interaction-logs.ts     Interaction logging utilities
```
