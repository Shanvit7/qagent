/**
 * Skill file template — Playwright browser testing edition.
 *
 * `qagent init` and `qagent skill` write this template to qagent-skill.md.
 * The dev fills it in manually or pastes the IDE prompt into Cursor / Claude Code.
 * qagent reads the file at test-generation time and injects it into the prompt.
 */

// ─── IDE prompt ──────────────────────────────────────────────────────────────

export const IDE_PROMPT = `You need to edit the file qagent-skill.md in this project's root.

qagent generates **behavioral regression tests** — real Playwright tests that verify
user flows still work after a component change. Before generating tests, it probes the
live app in a real browser to learn what's actually interactive at each viewport.

The skill file gives qagent the project context it can't discover from the browser alone:
which routes exist, what user flows matter, how auth works, what forms do, how navigation
is structured. Without it, the AI generates tests for the wrong routes with wrong assumptions.
With it, tests land on the correct flows on the first try.

Your job: explore this codebase and fill in every section of qagent-skill.md with real,
accurate information. The quality of the generated tests depends directly on this file.

## What qagent needs most

1. **Routes** — every URL and what it renders. Playwright needs to navigate somewhere.
2. **User flows** — the sequences a user follows (open menu, fill form, click link, see result).
   These become the behavioral tests: "user can do X" not "component has attribute Y".
3. **Auth** — which routes are protected, how to authenticate in a test (if at all).
4. **Interactive patterns** — forms, modals, toggles, dropdowns and how they behave.
5. **Responsive behavior** — what changes at mobile vs desktop (navigation, layouts).

## How to explore

Do not skim. Explore methodically:

1. **Project structure** — list src/ (or app/) and identify every major directory.
   Understand the architecture: is it feature-based? layer-based? flat?

2. **Framework & routing** — confirm Next.js App Router vs Pages Router vs Vite vs Remix.
   Check next.config, vite.config, or package.json scripts. Note the router type explicitly.
   List all route segments — the test generator needs to know what URLs exist.

3. **Route → component mapping** — this is critical for Playwright tests.
   - Which routes render which page components?
   - Are there dynamic routes? (e.g. /products/[id], /blog/[slug])
   - What layouts wrap which route groups?
   - Are there parallel routes or intercepting routes?

4. **User flows & navigation** — how does a user move through the app?
   - What are the primary navigation paths? (e.g. home → product list → product detail → cart → checkout)
   - What links/buttons trigger navigation?
   - Are there modal routes, slide-over panels, or tabs?

5. **Auth pattern** — find how auth works end-to-end:
   - Where does the session come from? (NextAuth, Clerk, Supabase, custom?)
   - What does the login flow look like in the browser? (redirect to /login, modal, third-party?)
   - Which routes are protected? Which are public?
   - How would a Playwright test authenticate? (cookie injection, API call, fill login form?)

6. **Data & loading states** — what does the user see while data loads?
   - Are there loading skeletons, spinners, or suspense boundaries?
   - What do empty states look like? (no items, no search results)
   - What do error states look like? (API failure, 404, permission denied)

7. **Interactive patterns** — find every interaction type in the app:
   - Forms: what library (React Hook Form, Formik, native)? What validation (Zod, Yup)?
   - Modals/dialogs: how are they triggered? How are they dismissed?
   - Dropdowns/selects: native or custom (Radix, Headless UI, shadcn)?
   - Toasts/notifications: what triggers them? Where do they appear?

8. **Responsive behavior** — how does the UI adapt?
   - Is there a mobile navigation (hamburger menu, bottom nav)?
   - At what breakpoints do layout changes happen?
   - Are there mobile-only or desktop-only features?

9. **Accessibility landmarks** — qagent uses accessible queries (getByRole, getByLabel):
   - What ARIA roles are used? (navigation, main, dialog, etc.)
   - Are buttons and links properly labeled with aria-label or visible text?
   - Are form inputs labeled?

10. **Environment & test data** — what does the dev server need?
    - What env vars does the app need to run?
    - Are there seed data scripts or fixture files?
    - What does a typical page look like with data vs without?

## Output format

Edit qagent-skill.md directly. Keep the existing section headings. Replace description
text with your findings from actual files. Remove sections with nothing to add. Never
invent or assume — only write what you confirmed by reading real code.

Now open qagent-skill.md and fill in every section.`;

// ─── Template file ───────────────────────────────────────────────────────────

export const SKILL_TEMPLATE = `<!-- Before generating tests, give this file to your agentic IDE (Cursor, Claude Code, etc.) and have it fill in every section by exploring your codebase. Run: qagent skill to see the prompt. -->

# qagent skill file

This file is injected into every Playwright test generation prompt. The test generator
sees one component at a time — it has no project-wide context unless this file provides it.
Fill every section with real information from your codebase.

## Project context

- **Framework**: <!-- e.g. Next.js 15 App Router -->
- **Source directory**: <!-- e.g. src/ -->
- **Architecture**: <!-- e.g. feature-based folders, shared components in src/components/ -->
- **Key directories** (with purpose):

## Routes & pages

Map every important route to what it renders. The test generator uses this to
navigate to the right URL and know what to expect on screen.

| Route | Page component | Description |
|-------|---------------|-------------|
| \`/\` | | Homepage |
| \`/about\` | | |

Dynamic routes:
<!-- e.g. /products/[id] — renders ProductDetailPage, needs a real product ID -->
<!-- e.g. /blog/[slug] — renders BlogPost, example slug: "getting-started" -->

Protected routes (require auth):
<!-- e.g. /dashboard, /settings, /admin/* -->

## Auth pattern

- **Library**: <!-- NextAuth / Clerk / Supabase / custom -->
- **Login URL**: <!-- e.g. /login, /auth/signin -->
- **Protected routes**: <!-- which routes redirect to login if unauthenticated -->

How to authenticate in a Playwright test:
\`\`\`ts
// Option A: fill the login form
await page.goto("/login");
await page.getByLabel("Email").fill("test@example.com");
await page.getByLabel("Password").fill("password123");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL("/dashboard");

// Option B: inject session cookie (faster)
// await context.addCookies([{ name: "session", value: "...", domain: "localhost", path: "/" }]);
\`\`\`

Test user credentials (if available):
<!-- e.g. email: test@example.com, password: password123 -->

## Navigation & layout

Describe the navigation structure so tests know what landmarks to expect.

### Header / navbar
<!-- What elements: logo, nav links, search, user menu, mobile hamburger? -->
<!-- What ARIA roles: navigation, banner? -->
<!-- Mobile breakpoint: e.g. below 768px shows hamburger menu -->

### Sidebar (if any)
<!-- What's in it? Is it collapsible? -->

### Footer
<!-- Key links, content -->

## User flows

Describe the critical journeys through the app. These become test scenarios.

### Flow: <!-- e.g. Product purchase -->
1. <!-- Navigate to /products -->
2. <!-- Click a product card -->
3. <!-- Click "Add to cart" -->
4. <!-- Navigate to /cart -->
5. <!-- Click "Checkout" -->
6. <!-- Fill shipping form -->
7. <!-- Submit order -->
8. <!-- See confirmation page -->

### Flow: <!-- e.g. User signup -->
1. <!-- ... -->

## Interactive elements

### Forms
- **Library**: <!-- React Hook Form / Formik / native controlled inputs -->
- **Validation**: <!-- Zod / Yup / HTML5 / custom -->

Example form pattern (how forms look in the browser):
\`\`\`
Form: "Create account"
  - Email input (label: "Email", required, type: email)
  - Password input (label: "Password", required, min 8 chars)
  - Submit button: "Create account"
  - Validation errors appear below each field as red text
  - Success: redirects to /dashboard
\`\`\`

### Modals / dialogs
<!-- How triggered? What role? e.g. clicking "Delete" opens a dialog with role="dialog" -->
<!-- How dismissed? Close button, click outside, Escape key? -->

### Custom UI components
<!-- e.g. shadcn Combobox: click trigger → popover with search input → select option -->
<!-- e.g. Date picker: click input → calendar popover → click date -->
<!-- These are harder to test than native HTML — describe the interaction pattern -->

## Loading & async states

Describe what the user sees while content loads. The test generator needs to know
what to wait for.

- **Loading indicators**: <!-- e.g. skeleton with data-testid="loading-skeleton", spinner with role="status" -->
- **Typical load time**: <!-- e.g. <500ms local, 1-2s with real API -->
- **Empty states**: <!-- e.g. "No results found" text, illustration -->
- **Error states**: <!-- e.g. "Something went wrong" with retry button -->

## Responsive behavior

- **Mobile breakpoint**: <!-- e.g. 768px -->
- **Mobile navigation**: <!-- e.g. hamburger button with aria-label="Menu" opens slide-out nav -->
- **Layout changes**: <!-- e.g. 2-column → single column below 1024px, sidebar hidden on mobile -->

## Accessibility landmarks

List the ARIA roles and labels the test generator should use for queries:

\`\`\`
- banner: site header
- navigation: main nav (desktop), mobile nav (in hamburger menu)
- main: page content
- contentinfo: footer
- dialog: modals (e.g. "Delete confirmation", "Edit profile")
- search: search input in header
\`\`\`

## Business domain

- **Core entities**: <!-- e.g. User { name, email, role }, Product { name, price, stock } -->
- **Key state transitions**: <!-- e.g. Order: pending → processing → shipped → delivered -->
- **Validation rules**: <!-- e.g. email required, password 8+ chars, price > 0, title max 200 chars -->
- **Role-based access**: <!-- e.g. admin can delete any post, users can only edit their own -->
- **Critical invariants**: <!-- e.g. stock can never go negative, completed orders can't be modified -->

## Test data & environment

- **Dev server command**: <!-- e.g. npm run dev, runs on port 3000 -->
- **Required env vars**: <!-- e.g. DATABASE_URL, NEXT_PUBLIC_API_URL -->
- **Seed data**: <!-- e.g. npm run db:seed creates 10 products, 3 users -->
- **Known test IDs**: <!-- e.g. product with ID "prod_123" always exists in dev -->
`;
