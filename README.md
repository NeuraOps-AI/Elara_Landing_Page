# ELARA local website and leads CRM

A responsive property website using the supplied ELARA and Grupe Nayan branding, villa renders, location map and project film. No package installation is needed.

## Start

Requires Node.js 20 or newer. In this folder run:

```powershell
npm start
```

Or double-click `start-elara.cmd`.

- Website: http://localhost:3000
- Leads CRM: http://localhost:3000/crm

Keep the server terminal open. Stop with Ctrl+C. If port 3000 is occupied, use `$env:PORT=3002` then `npm start`.

## Enquiries and downloads

Visitors enter their name, phone and email, select an interest and documents, and consent to a sales follow-up. The backend validates the form and saves the lead before issuing download links. A brochure or price-sheet request starts the selected PDF download. Selecting both starts a ZIP containing both original PDFs; individual download links also remain available. Links last 24 hours. Private PDFs are never served as public static files.

There was no original brochure among the supplied assets. `private/ELARA-Brochure.pdf` is a new three-page project overview assembled from the supplied branding, renderings and location map. The supplied price sheet is copied without modification to `private/ELARA-Price-Sheet.pdf`.

## Leads workspace

The CRM starts empty. It offers search, status and document filters, newest/oldest sorting, refresh, CSV export, and a lead drawer with contact details, enquiry message, editable status and private notes. Statuses: New, Contacted, Qualified, Site visit, Closed, Lost. Times display in India Standard Time.

Leads, notes and hashed download grants persist in `data/leads.json`. Back up this file before replacing or moving the project. It contains personal enquiry information and is excluded from Git. Test data is isolated from this file.

This is a local development application. It binds only to `127.0.0.1` and has no CRM login. Before a public deployment, add authenticated staff access, production storage and a reviewed privacy policy.

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
- `public/assets/`: extracted logos and optimized supplied media
- `private/`: gated brochure and price sheet
- `server.mjs`: local HTTP server, validation, persistence and downloads
- `scripts/prepare_assets.py`: reproducible asset and brochure preparation

The asset script uses Pillow, pypdf, reportlab and Poppler. These are only required when rebuilding assets; the website itself uses Node.js standard libraries.

## Verify

```powershell
npm test
```

Tests use temporary fixture data and cover enquiry validation, persistence, protected downloads, ZIP structure, CRM updates, CSV escaping, origin checks and private path protection.

All source material in the project root is retained unchanged. No site has been published.

## Animated morning scene

The opening composition uses HTML/CSS for the layout and Three.js for a 16-second sunrise behind the villas. The small sun changes from peach-amber through pale gold to ivory as it rises, with a copper edge that softens toward cream. Its restrained warm haze tightens and fades with elevation. The sky, villa and plants share the same sunrise clock: cool subdued dawn, a brief golden phase, then calm morning light. The architecture remains still while foliage sways with varying gusts and a sparse set of leaves tumbles down from the trees and planted balconies. Replay restarts the sunrise; Pause freezes all movement and lighting, including airborne leaves. Operating-system reduced-motion preferences start the scene in static daylight without airborne leaves. Rendering stops when the scene is offscreen or the tab is hidden, and a normal image remains available if WebGL fails. The villa artwork is a flat, transparent layer; this is a layered animation rather than a navigable 3D building model.

The three balcony planting strips, four street trees, rear tree and four low shrub beds use independently deforming meshes with their original photographed leaves and flowers. Pixel masks separate these from the architecture; a reconstructed backing is revealed only through the vacated plant masks. Wind bends the plant silhouettes from anchored roots instead of distorting the entire villa image. Region bounds and bend strengths are defined in `public/plant-wind.js`.

The terrace sunrise takes 24 seconds, easing gently above the horizon. The same elevation controls the sun color and the panorama lighting: cool ambient dawn, soft gold around the rising sun, then clear pale-blue morning. A shared linear-light shader grades the panorama, clean backing and moving foliage identically; the atmospheric band stays anchored to the photographed horizon as the camera turns. Replay resets the complete lighting transition, Pause freezes it, and reduced-motion mode starts at the finished morning state.

The second section is an imagined first-person morning on the terrace. Its curved cream parapet, bronze railing, warm wall finishes and flowering planters follow the supplied villa reference. A curved photographic panorama supports a small, eased camera turn, with a horizon-masked sunrise and coffee steam. The Wonderla landmark follows the supplied image: a blue-glass tower, broad red observation deck and rooftop wheel, integrated into the photographic landscape with matching daylight, atmospheric depth and greenery around its base. Nearby homes, small cars and distant walkers give the setting a lived-in morning atmosphere beneath a pale-blue sky. The landmark and these background details are part of the still artwork; the wheel does not rotate.

Eleven masked plant clumps bend from anchored roots with independent gusts; a reconstructed backing prevents doubled foliage while the balcony stays still. Pointer movement, horizontal touch dragging, arrow keys and the two named view buttons offer ways to look around. Pause freezes the plants, steam and sunrise together. A light vignette preserves the clear morning atmosphere, with local translucent backgrounds keeping playback and view controls readable. The view is explicitly conceptual: it does not establish actual views, distances or landmark positions from an ELARA villa. The Sky Wheel name is referenced from Wonderla's official Hyderabad brochure: https://www.wonderlacorp.com/assets/deck/Hyderabad_deck.pdf. The terrace and its clean backing were edited with the built-in image generation tool; their exact prompts are saved in `output/morning-terrace-v3-generation.txt` and `output/morning-terrace-v3-cleanplate-generation.txt`. Earlier artwork is retained.

The hero preserves the supplied offer: ₹2.25 Cr, a crossed-out regular price of ₹3.05 Cr, and availability limited to the first 10 confirmed qualifying bookings. “Request pricing” opens a price-and-availability enquiry with the price sheet selected; “Arrange a private visit” selects the site-visit enquiry. The existing enquiry/download system remains connected.
