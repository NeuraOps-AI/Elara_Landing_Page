# ELARA website and leads CRM

A responsive property website using the supplied ELARA and Grupe Nayan branding, villa renders, location map and project film. It runs locally with Node.js or on Netlify with Functions and Blobs.

## Start

Requires Node.js 22.12 or newer. In this folder run:

```powershell
npm ci
npm start
```

Or double-click `start-elara.cmd`.

- Website: http://localhost:3000
- Leads CRM: http://localhost:3000/CRM/112026 (password required)

Keep the server terminal open. Stop with Ctrl+C. If port 3000 is occupied, use `$env:PORT=3002` then `npm start`.

Unknown page addresses, including mistyped or old CRM URLs, redirect to the landing page at `/`. The correct CRM address remains password-protected. API errors and missing background assets keep their error responses.

## Enquiries and downloads

Visitors enter their name, phone and email, select an interest and documents, and consent to a sales follow-up. The backend validates the form and saves the lead before issuing download links. A brochure or price-sheet request starts the selected PDF download. Selecting both starts a ZIP containing both original PDFs; individual download links also remain available. Links last 24 hours. Private PDFs are never served as public static files.

There was no original brochure among the supplied assets. `private/ELARA-Brochure.pdf` is a new three-page project overview assembled from the supplied branding, renderings and location map. The supplied price sheet is copied without modification to `private/ELARA-Price-Sheet.pdf`.

## Leads workspace

The CRM requires a password at `/CRM/112026` before showing the dashboard or any lead data. It offers search, status and document filters, newest/oldest sorting, refresh, CSV export, and a lead drawer with contact details, enquiry message, editable status and private notes. Statuses: New, Contacted, Qualified, Site visit, Closed, Lost. Times display in India Standard Time. The public website does not link to the CRM; the old `/crm` and direct `/crm.html` routes are unavailable.

Set or change the password with `npm run crm:password`, then restart the server. Password entry is hidden; only a salted scrypt hash is saved to the ignored `data/crm-auth.json` file. The actual password is never written into client code or Git. An optional `CRM_PASSWORD` environment variable overrides that local file. Without a configured password, CRM sign-in stays unavailable and all lead APIs remain locked; public enquiries and document downloads still work.

Sign-in creates an opaque HttpOnly, SameSite=Strict session cookie lasting eight hours. Sessions expire on restart and are revoked by Sign out. Five failed attempts from the same address trigger a fifteen-minute sign-in limit. Lead reads, changes and CSV exports require authentication on the server; the CRM pages and responses are not cached.

Leads, notes and hashed download grants persist in `data/leads.json`. Back up this file before replacing or moving the project. It contains personal enquiry information and is excluded from Git. Test data is isolated from this file.

The local server binds only to `127.0.0.1`. The Netlify deployment uses the same protected routes over HTTPS, with shared server-side sessions and durable lead storage as described below.

## Netlify deployment

The CRM is a server-rendered route, not a static HTML URL. Publishing only `public/` causes Netlify to return 404 for `/CRM/112026` and leaves the API unavailable. The checked-in `netlify.toml` builds `dist/` and deploys `netlify/functions/elara.mjs`; do not override the publish directory back to `public` or add an SPA rewrite to `index.html`.

1. Connect the repository and select the branch to deploy. To preview the `dev` fix, enable a branch deploy for `dev` in Netlify.
2. Add `CRM_PASSWORD` in **Netlify → Project configuration → Environment variables**, with the chosen password (12–256 characters). Include the **Functions** scope when scope selection is available, and set the appropriate production/branch deploy context. Do not put this password in `netlify.toml`, source code or a client-side variable.
3. Deploy again after setting or changing the variable. Netlify reads `npm run build`, publish directory `dist`, and the function directory from this repository. The local `data/crm-auth.json` is deliberately not uploaded, so hosted sign-in will stay unavailable until the environment variable is set.
4. Open `/CRM/112026` on that deployment. It should show sign-in, require the password, and keep `/api/leads` locked without a session. Unknown page URLs redirect to `/`.

Netlify Blobs automatically supplies storage credentials inside the function. The `elara-crm` site store retains production leads, notes and download grants across deploys. Strong reads and conditional writes prevent concurrent requests from silently replacing each other's changes. Branch/preview URLs have separate data namespaces and cannot view production leads. Previous, unpublished production deploys return 410 instead of accessing current production data.

Hosted sessions and sign-in limits are also stored server-side, so cold starts do not sign users out or reset password-attempt limits. Cookies use Secure, HttpOnly and SameSite=Strict. Each new deployment starts a fresh session namespace; redeploying after a password change revokes old sessions. Local `data/leads.json` and local credentials remain local and are not migrated by a Git push.

CRM HTML and private PDFs are included only in the function bundle, never in `dist/`. CSS, scripts, fonts, images and the landing page are served by Netlify's CDN. The backend retains the existing enquiry, download, ZIP, CSV and lead-update endpoints.

To check the static build locally, run `npm run build`. For the complete Netlify function bundle check, run `npx netlify-cli build --offline`. Verify the deployed CRM sign-in, an enquiry/download, sign-out, and a wrong page URL after deployment.

To run the Netlify router locally in PowerShell, set `$env:NETLIFY_DEV='true'` and then run `npx netlify-cli serve --offline`. Supply a separate test password through `CRM_PASSWORD`. With this development flag and a loopback origin, the app uses isolated files in ignored `.netlify/elara-dev/`: the current Blobs emulator omits the ETags required for conditional reads/updates. Hosted deployments always use Blobs and fail closed if a record has no version; they never silently fall back to local files. This local mode checks routing and authentication; the conditional-write tests cover cross-instance concurrency separately.

Reference: [Netlify Functions routing](https://docs.netlify.com/build/functions/configuration/), [runtime environment variables](https://docs.netlify.com/build/functions/environment-variables/) and [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

## Files to edit

- `public/index.html`: marketing content and sections
- `public/styles.css`: website design and responsive styling
- `public/sections.css`: editorial sections, gallery, downloads and enquiry styling
- `public/app.js`: enquiry forms, download workflow, image previews and film
- `public/sunrise.css`: warm reference layout, right-side villas and responsive hero
- `public/sunrise-scene.js`: Three.js sunrise and foliage animation; replay/pause, reduced motion and static fallback
- `public/plant-wind.js`: original-photo plant masks and anchored canopy/terrace mesh bending
- `public/sunrise-lighting.js`: shared, subtle sunrise tint for the villa and moving plant layers
- `public/luxury.css`: editorial typography, offer styling and responsive page composition
- `public/fonts/`: locally served Cormorant Garamond and Manrope fonts with OFL licenses
- `public/morning-scene.js` and `public/morning.css`: first-person terrace experience and controls
- `public/realistic-sun.js`: shared sun material with a bright core, warm limb and restrained atmospheric glow
- `public/morning-lighting.js`: shared terrace dawn-to-morning exposure, color and horizon haze, also applied to the moving plants
- `public/terrace-plants.js`: eleven independently bending photo-derived terrace plant layers
- `public/assets/morning-terrace-v3.png`: villa-matched curved balcony, coffee and morning landscape with an integrated photographic Wonderla landmark and surrounding homes
- `public/assets/morning-terrace-v3-cleanplate.png`: matching backing revealed only behind the moving terrace foliage
- `public/assets/villa-sunrise.png`: transparent villa artwork derived from the supplied visual reference
- `public/assets/villa-sunrise-cleanplate.png`: reconstructed backing used only where moving plant silhouettes reveal the background
- `public/vendor/three.module.js`: locally served Three.js r170, with its MIT license alongside
- `public/crm.html`, `public/crm.css`, `public/crm.js`: leads workspace
- `public/crm-login.html`, `public/crm-login.css`, `public/crm-login.js`: password sign-in screen
- `crm-auth.mjs`: password verification, sessions and sign-in limits
- `scripts/set-crm-password.mjs`: local password setup without saving plaintext
- `public/assets/`: extracted logos and optimized supplied media
- `private/`: gated brochure and price sheet
- `server.mjs`: local HTTP server, validation, persistence and downloads
- `storage.mjs`: atomic local files and conditional Netlify Blobs transactions
- `netlify-app.mjs`: adapter for the shared application routes
- `netlify/functions/elara.mjs`, `netlify.toml`: hosted routing, deployment and storage configuration
- `scripts/build-netlify.mjs`: static build excluding protected HTML and documents
- `scripts/prepare_assets.py`: reproducible asset and brochure preparation

The asset script uses Pillow, pypdf, reportlab and Poppler. These are only required when rebuilding assets. Hosted execution uses the dependencies pinned in `package-lock.json`.

## Verify

```powershell
npm test
```

Tests use temporary fixture data and cover enquiry validation, persistence, protected downloads, ZIP structure, authenticated CRM updates, CSV escaping, origin checks, private path protection, password verification, session expiry/logout and sign-in limits. Netlify tests also cover independent function instances, concurrent conditional writes, deployment/preview isolation and request size limits.

All source material in the project root is retained unchanged. Pushing code does not configure Netlify secrets or migrate local lead records.

## Animated morning scene

The opening composition uses HTML/CSS for the layout and Three.js for a 16-second sunrise behind the villas. The small sun changes from peach-amber through pale gold to ivory as it rises, with a copper edge that softens toward cream. Its restrained warm haze tightens and fades with elevation. The sky, villa and plants share the same sunrise clock: cool subdued dawn, a brief golden phase, then calm morning light. The architecture remains still while foliage sways with varying gusts and a sparse set of leaves tumbles down from the trees and planted balconies. Replay restarts the sunrise; Pause freezes all movement and lighting, including airborne leaves. Operating-system reduced-motion preferences start the scene in static daylight without airborne leaves. Rendering stops when the scene is offscreen or the tab is hidden, and a normal image remains available if WebGL fails. The villa artwork is a flat, transparent layer; this is a layered animation rather than a navigable 3D building model.

The three balcony planting strips, four street trees, rear tree and four low shrub beds use independently deforming meshes with their original photographed leaves and flowers. Pixel masks separate these from the architecture; a reconstructed backing is revealed only through the vacated plant masks. Wind bends the plant silhouettes from anchored roots instead of distorting the entire villa image. Region bounds and bend strengths are defined in `public/plant-wind.js`.

The terrace sunrise takes 24 seconds, easing gently above the horizon. The same elevation controls the sun color and the panorama lighting: cool ambient dawn, soft gold around the rising sun, then clear pale-blue morning. A shared linear-light shader grades the panorama, clean backing and moving foliage identically; the atmospheric band stays anchored to the photographed horizon as the camera turns. Replay resets the complete lighting transition, Pause freezes it, and reduced-motion mode starts at the finished morning state.

The second section is an imagined first-person morning on the terrace. Its curved cream parapet, bronze railing, warm wall finishes and flowering planters follow the supplied villa reference. A curved photographic panorama supports a small, eased camera turn, with a horizon-masked sunrise and coffee steam. The Wonderla landmark follows the supplied image: a blue-glass tower, broad red observation deck and rooftop wheel, integrated into the photographic landscape with matching daylight, atmospheric depth and greenery around its base. Nearby homes, small cars and distant walkers give the setting a lived-in morning atmosphere beneath a pale-blue sky. The landmark and these background details are part of the still artwork; the wheel does not rotate.

Eleven masked plant clumps bend from anchored roots with independent gusts; a reconstructed backing prevents doubled foliage while the balcony stays still. Pointer movement, horizontal touch dragging, arrow keys and the two named view buttons offer ways to look around. Pause freezes the plants, steam and sunrise together. A light vignette preserves the clear morning atmosphere, with local translucent backgrounds keeping playback and view controls readable. The view is explicitly conceptual: it does not establish actual views, distances or landmark positions from an ELARA villa. The Sky Wheel name is referenced from Wonderla's official Hyderabad brochure: https://www.wonderlacorp.com/assets/deck/Hyderabad_deck.pdf. The terrace and its clean backing were edited with the built-in image generation tool; their exact prompts are saved in `output/morning-terrace-v3-generation.txt` and `output/morning-terrace-v3-cleanplate-generation.txt`. Earlier artwork is retained.

The hero preserves the supplied offer: ₹2.25 Cr, a crossed-out regular price of ₹3.05 Cr, and availability limited to the first 10 confirmed qualifying bookings. “Request pricing” opens a price-and-availability enquiry with the price sheet selected; “Arrange a private visit” selects the site-visit enquiry. The existing enquiry/download system remains connected.
