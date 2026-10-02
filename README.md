# Catalin Bondari: portfolio site

Static site for GitHub Pages: https://catalinbondari.github.io/eportfolio-website/

Plain semantic HTML, one stylesheet and one small script. No framework, no build step.

## Structure

```
index.html                         Home: hero, about, experience, work, credentials, contact
work/bond-portfolio-centre.html    Case study
work/weekly-market-update.html     Case study
demo/bond/                         Live demo: Bond Portfolio Centre static export (synthetic data, noindex)
demo/weekly/index.html             Live demo: Weekly Market Update deck, one self-contained file (noindex)
404.html                           Self-contained (GitHub Pages serves it at any depth)
assets/css/site.css                Tokens, layout, components, motion
assets/js/site.js                  Theme toggle, mobile nav, on-load reveal, contact form
assets/fonts/                      Newsreader 500, IBM Plex Sans 400/500/600, IBM Plex Mono 400 (OFL, latin subset)
assets/img/                        Favicon, touch icon, Open Graph image
```

## Demos

Both demos are live and are copied in as built output; nothing is built in this repository.

- `demo/bond/` is the `dist/` folder of the private bond-portfolio-demo repository
  (`python3 -m fundengine build --demo-only`). Fictional books and a seeded synthetic
  price history; relative paths only, so it works under any subpath.
- `demo/weekly/index.html` is the `index.html` of the private weekly-market-update
  repository (`python3 src/validate.py && python3 src/rebuild.py`).

To refresh a demo, rebuild it in its own repository, replace the folder or file here
and commit. Each demo carries a back link to the portfolio (`../../`).

Links between pages are relative so the site works both at a domain root and under
the `/eportfolio-website/` project path. Absolute URLs are only used in meta tags,
`sitemap.xml`, `robots.txt` and `404.html`.

## Design system: "Quiet ledger"

- Type: Newsreader 500 for headings, IBM Plex Sans for body and UI, IBM Plex Mono
  (tabular figures) for dates and numbers. Body line-height 1.6, measure about 65ch.
- Layout: 4pt spacing scale, 1120px max width, 16px mobile gutter.
- Motion: transform and opacity only, ease-out `cubic-bezier(0.23,1,0.32,1)`.
  One on-load reveal (fade + 8px rise, 40ms stagger, at most 6 items). Hover effects
  only under `(hover:hover) and (pointer:fine)`. Reduced motion: fades only, 150ms.

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| fg on bg / surface | 17.09 / 17.85 | 15.92 / 14.76 |
| muted on bg / surface | 7.26 / 7.58 | 7.46 / 6.92 |
| accent on bg / surface | 9.92 / 10.36 | 7.63 / 7.08 |
| warm accent on bg / surface | 4.71 / 4.92 | 8.70 / 8.06 |
| button text on accent | 10.36 | 7.63 |
| form control edge on bg (3:1 for UI) | 3.48 | 3.84 |

The decorative `--border` token is only used for rules, never for control edges.

## TODO

- Add a CV link in the hero once a cleaned CV is available (see comment in `index.html`).
- Link the churn-prediction coursework repository once it has a neutral slug.
- Remove the `noindex` on the demos if they should be indexed.
- Current role: add the start date in the timeline (comment in `index.html`).
- Weekly Market Update: add who the briefing is for (comment in the case study).
