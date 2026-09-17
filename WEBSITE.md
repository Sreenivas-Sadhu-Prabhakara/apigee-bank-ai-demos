# Website and downloadable HTML

The implementation pack is presented as a static site with ten views: an overview, five banking demos, and four supporting guides. The banking applications described by the guides are separate future implementations.

## Build and preview

```bash
npm ci
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. The build reads the original Markdown and Postman assets, renders syntax-highlighted HTML, and writes the publishable site to `docs/`. There is no browser CDN dependency or runtime Markdown fetch.

Run `npm run test:site` while the preview server is running. It checks guide navigation, search, code copying, download links, mobile layout, and the offline edition. Browser screenshots are saved to the ignored `test-results/` folder. If needed, install a browser with `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing Chromium executable.

## Offline edition

`docs/downloads/banking-ai-playbook.html` is one self-contained HTML file. Its stylesheet, JavaScript, guides, search index, and downloadable Markdown/Postman assets are embedded. Save it and open it in a browser without running a server. External reference links still require internet access.

The hosted site provides a prominent **Download HTML** action in the top bar and download section. ZIP bundles of the original guides and Postman assets are available separately.

## GitHub Pages

Publish branch `main`, folder `/docs`. The `.nojekyll` file keeps the generated HTML and assets intact. After changing source guides or site assets, run `npm run build`, commit the source and generated `docs/` output, and push. No model API, bank backend, credentials, or private machine access is hosted by this site.
