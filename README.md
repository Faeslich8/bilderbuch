<p align="center">
  <img src="public/icon.png" alt="BilderBuch" width="128" height="128" />
</p>

<h1 align="center">BilderBuch</h1>

<p align="center">
  Create print-ready <strong>photo books</strong> — from your
  <a href="https://immich.app/">Immich</a> albums <em>or</em> your own uploaded photos.<br />
  Self-hosted, privacy-first, with high-quality PDF export.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#self-hosting-recommended">Self-hosting</a> ·
  <a href="#using-bilderbuch">Usage</a> ·
  <a href="#license">License</a>
</p>

> **BilderBuch** is a fork of
> [ch1bo/immich-book](https://github.com/ch1bo/immich-book) by Sebastian Nagel,
> substantially extended: **local albums** (build books from your own uploads —
> works even without Immich), a **collage / masonry mode** (switchable per page),
> **per-image alignment**, design/blank spaces, drawing, an insertable map, DIN
> formats, single/double-page view, a title page, zero-input central connection
> and a shared cross-device editing store.
> Licensed under AGPL-3.0 (see [LICENSE](LICENSE)); all modifications remain under
> the same license. "Immich" is a trademark of the Immich project; BilderBuch is an
> independent companion tool and not affiliated with or endorsed by Immich.

## Why BilderBuch?

Turn curated photo collections into professional-quality photo books you can print or share as PDFs — using photos from Immich or uploaded directly.

- **Privacy-first** — your photos stay on your own server
- **Immich _or_ standalone** — build books from Immich albums, or from your own uploads (no Immich required)
- **No subscriptions** — free and open source (AGPL-3.0)
- **Print anywhere** — export high-quality, print-ready PDFs

## Screenshots

<!-- Add your own screenshots here. BilderBuch is self-hosted and works with your
     private library, so please use photos you're happy to share publicly.
     Drop images into docs/screenshots/ and reference them below, e.g.:
     ![Album overview](docs/screenshots/overview.png)
     ![Editor with collage page](docs/screenshots/collage.png)
     ![PDF export](docs/screenshots/pdf.png) -->

> _Screenshots welcome!_ Because BilderBuch runs against your own (private)
> library, this section is intentionally left for you to add screenshots of your
> choosing — put images in [`docs/screenshots/`](docs/screenshots) and link them
> here.

## Features

### Albums & Connection

- **Immich albums** — browse and select from all your albums via a same-origin `/api` proxy (no server URL to enter)
- **Local albums** — create books from your **own uploaded photos**; works **entirely without Immich** ("start without Immich"), rename/delete on the start page
- **Zero-input for the whole network** — optional central API key (`IMMICH_API_KEY`) so every device connects automatically
- **Shared editing state across devices** via a small central store (see below) — no more per-device divergence

### Layout

- **Grid (justified) layout** using @immich/justified-layout-wasm
- **Collage / masonry mode** — tiles of different heights, aspect-preserving; a tall tile spans rows while neighbours stack, bottoms aligned
- **Switchable per page** — mix grid and collage spreads in one book (per-page toggle) without re-paginating the rest
- Page formats: **DIN A3–A6** plus custom dimensions, portrait/landscape
- **Single- and double-page (open-book) view**
- Adjustable layout parameters (margin, row height, spacing); configurable page background; per-album configuration with global fallback

### Photo Customization

- Drag borders to change a photo's aspect ratio; drag & drop to reorder
- **Per-image alignment** — align a single photo left/center/right within the free space of its row
- In collage mode, mark a photo as a **tall tile** (spans rows)
- **Crop / reposition** the visible section of a photo
- **Detach a photo from the auto-layout** for free placement, resizing and rotation
- Custom captions with text styling (size, font, color, background)
- Cycle description positions (bottom, top, left, right); toggle dates/descriptions
- Reset per-photo customizations (shown on hover)

### Design Elements

- **Blank pages and design/blank spaces** ("Leerräume") insertable at any position
- **Drawing zones** — sketch with pen/finger/mouse into a blank space
- **Insertable, zoomable map** showing the GPS coordinates of a page's photos, in the Immich map style
- **Title page** with image, title/subtitle, own text styling and portrait/landscape option
- Transparent blank-space background option

### Preview & Export

- Live preview with actual page layout and dimensions
- High-quality PDF export using @react-pdf/renderer (single source of truth for web + PDF)
- Clean, responsive UI built with React and Tailwind CSS

## Getting Started

You will need:

- An Immich server with API access
- An Immich API key with the following permissions:
  - `album.read` - To browse and list albums
  - `asset.read` - To read asset metadata (descriptions, dates, etc.)
  - `asset.view` - To access photo thumbnails and images

### Creating an API Key

1. Log into your Immich instance
2. Go to **Account Settings** → **API Keys**
3. Click **New API Key**
4. Give it a descriptive name (e.g., "BilderBuch")
5. Select the required permissions:
   - `album.read`
   - `asset.read`
   - `asset.view`
6. Click **Create**
7. Copy the API key (you won't be able to see it again!)

### Enable CORS on Your Immich Server

> [!NOTE]
> Only needed if you connect the browser **directly** to Immich on a **different origin** (i.e. you removed the same-origin `/api` proxy). The recommended [self-hosted setup](#self-hosting-recommended) below proxies same-origin and needs **no** CORS configuration.

Allow CORS requests from **this app's own origin**. Add this to your Immich server's nginx configuration (inside the `server` block or `location /api` block):

```nginx
# Allow CORS for this app's origin
if ($request_method = 'OPTIONS') {
    add_header 'Access-Control-Allow-Origin' 'https://book.example.com' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'x-api-key, Content-Type, Accept' always;
    add_header 'Access-Control-Max-Age' 1728000;
    add_header 'Content-Type' 'text/plain charset=UTF-8';
    add_header 'Content-Length' 0;
    return 204;
}

add_header 'Access-Control-Allow-Origin' 'https://book.example.com' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'x-api-key, Content-Type, Accept' always;
```

**Important:**

- Never use `Access-Control-Allow-Origin: *` (wildcard) - it's a security risk
- Only add CORS headers for domains you trust
- Reload nginx after changes: `sudo nginx -s reload`

### Self-Hosting (Recommended)

Self-hosting on the same domain as your Immich server is the most secure option and doesn't require CORS configuration.

First, build the application:

```bash
git clone https://github.com/Faeslich8/bilderbuch.git
cd bilderbuch
npm install
npm run build
```

#### Option 1: Subdirectory Deployment

Deploy to a subdirectory of your Immich domain (e.g., `https://photos.example.com/book/`).

Configure nginx (or your reverse proxy):

```nginx
location /book/ {
    alias /path/to/bilderbuch/dist/;
    try_files $uri $uri/ /book/index.html;
}
```

Reload nginx, for example using `sudo nginx -s reload`

#### Option 2: Subdomain Deployment

Deploy to a subdomain (e.g., `https://book.photos.example.com/`).

Configure nginx (or your reverse proxy):

```nginx
server {
    server_name book.photos.example.com;
    root /path/to/bilderbuch/dist;
    try_files $uri $uri/ /index.html;

    # Add SSL configuration as needed
}
```

Reload nginx, for example using `sudo nginx -s reload`

#### Option 3: Docker

A `Dockerfile` and `docker-compose.yml` are included. The image builds the static
site and nginx serves it **and** proxies `/api/` same-origin to your Immich server
(configured via the `IMMICH_URL` environment variable, e.g. `http://immich-server:2283`
when both containers share a Docker network). Because the browser only ever talks to
this one origin, **no CORS configuration on Immich is needed** — set `IMMICH_URL` in
`docker-compose.yml` to point at your Immich server and you're done.

```bash
docker compose up --build -d
```

The app is then available on <http://localhost:8080> (change the host port in
`docker-compose.yml` if you like). You **don't** need to enter a server URL — the app
always talks to Immich same-origin via the `/api` proxy. Just enter your API key once
per device.

**Zero-input for the whole network:** set the `IMMICH_API_KEY` environment variable in
`docker-compose.yml` / `portainer-stack.yml`. It is delivered to the browser at load
time (`/config.js`), so **every device on the network connects automatically without
entering anything**. Leave it empty to have each device prompt for its own key instead.

> **Security note:** the injected key is served in plaintext to anyone who can load the
> page. Prefer a **dedicated** Immich API key (not your admin key) scoped to what the
> book needs, since anyone on your LAN who opens the app gains that access.

**Shared editing state across devices:** the container serves a small WebDAV file store
under `/store/` backed by the `immichbook-store` volume (mounted at `/data`). The app
saves each album's editing state (ordering, aspect ratios, blank/design spaces, maps,
title page, …) there and loads it on open, so **every device sees the same progress**.
`localStorage` stays as a local cache/offline fallback; if the store is unreachable the
app just works per-device as before. Conflicts resolve last-write-wins — fine for a home
setup. Keep the `immichbook-store` volume to preserve books across redeploys.

**Pre-built image (Portainer web editor):** pushes to `main` build and publish the
image to `ghcr.io/<owner>/bilderbuch:latest` via `.github/workflows/docker-image.yml`.
You can then deploy without any build context — paste `portainer-stack.yml` into
Portainer's stack editor (or any compose that uses
`image: ghcr.io/<owner>/bilderbuch:latest`), adjusting `IMMICH_URL`, `IMMICH_API_KEY`
and the network name to match your setup. Make the package public, or add ghcr.io
registry credentials in Portainer, so it can be pulled.

> If you'd rather connect directly from the browser to Immich instead of using the
> same-origin proxy (e.g. Immich runs on a different host), remove the `IMMICH_URL`
> environment variable and the `location /api/` block from `nginx.conf.template` —
> then you must **allow CORS** for this app's origin on your Immich server, see
> [Enable CORS](#enable-cors-on-your-immich-server).

### Using BilderBuch

1. **Open the app**
   - If a central `IMMICH_API_KEY` is configured, you're connected automatically — nothing to enter.
   - Otherwise enter your Immich API key and click **Connect** (no server URL needed — it's same-origin).
   - No Immich? Click **"Start without Immich"** to use local albums only.

2. **Pick or create an album**
   - **Immich album** — click any album to open it.
   - **Local album** — click **New album**, give it a name, then **Add photos** (drag & drop or file picker). An empty album shows a blank page to drop onto. Rename/delete local albums from their card on the start page.

3. **Choose the page layout**
   - **Single / Double** — single pages or an open-book spread.
   - **Grid / Collage** (global default) — grid = justified rows; collage = tiles of varying heights (aspect-preserving).
   - **Per page** — each spread has its own **Grid/Collage** toggle, so you can mix layouts without re-paginating the rest.
   - **Settings (gear)** — page format (DIN A3–A6 or custom), margin, row height, spacing, page background, dates/descriptions, exclude videos.

4. **Arrange photos**
   - **Drag & drop** to reorder; drag a photo's **left/right border** to change its aspect ratio.
   - **Alignment** icon (per photo) — align it left/center/right in the free space of its row.
   - **Auto** (per page, grid) resets manual sizes so the row redistributes evenly; **Auto‑Collage** (per page, collage) turns the page into a masonry.
   - In **collage** mode, the **↕** icon makes a photo a **tall tile** (spans rows; neighbours stack, bottoms aligned).
   - **Crop**, **caption**, or **detach for free placement** from each photo's hover toolbar.

5. **Add design elements** (Insert menu)
   - **Blank page** / **blank space** ("Leerraum"), **text**, **shape/emoji**, a **drawing zone**, or an **insertable map** showing the GPS coordinates of a page's photos.
   - Add a **title page** with image, title/subtitle and portrait/landscape option.

6. **Export**
   - Click **Generate PDF** for a print-ready preview, download from the viewer toolbar, and **Back to editor** to keep editing.
   - Your edits are saved automatically and shared across devices via the central store.

## Development

Clone and install:

```bash
git clone https://github.com/Faeslich8/bilderbuch.git
cd bilderbuch
npm install
```

Create a `.env` file to avoid CORS issues:

```bash
# .env
VITE_IMMICH_PROXY_TARGET=https://your-immich-server.com
```

Start the development server:

```bash
npm start
```

The app will be available at http://localhost:5173

Other commands:

```bash
npm run build       # Build for production (output in dist/)
npm run type-check  # Run TypeScript type checking
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

> [!NOTE]
> This is still a proof of concept with plenty of AI generated code and no tests.

## Acknowledgments

- [Immich](https://immich.app/) - For the amazing self-hosted photo management platform
- [@immich/justified-layout-wasm](https://www.npmjs.com/package/@immich/justified-layout-wasm) - For the layout algorithm
- [@react-pdf/renderer](https://react-pdf.org/) - For PDF generation capabilities

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

This means you are free to use, modify, and distribute this software, provided that:

- You disclose the source code of any modifications
- You license derivative works under AGPL-3.0
- You provide source code access to users interacting with the software over a network (e.g., SaaS deployments)

See the [LICENSE](LICENSE) file for the full terms.

> **Note on commercial licensing:** The *original* project (ch1bo/immich-book)
> offers commercial licensing for its code via ncoding.li (immich-book@ncoding.li).
> This BilderBuch fork adds further changes that are only available under AGPL-3.0
> — a commercial use would require agreement from **both** the original author and
> this fork's contributors. This fork does not, by itself, offer a commercial license.

---

**Copyright © 2025 Sebastian Nagel** (original immich-book)
**Modifications © 2025–2026 the BilderBuch contributors**, licensed under AGPL-3.0
