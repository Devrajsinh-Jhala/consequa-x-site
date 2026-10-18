# Consequa-X website

Public source for the Consequa-X landing page, documentation, evidence
inspector and live package demo. The Python framework is available on
[PyPI](https://pypi.org/project/consequa-x/1.1.0/).

[Deploy to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FDevrajsinh-Jhala%2Fconsequa-x-site)

The Blueprint creates one static site with root directory `website`, build
command `true`, and publish directory `dist`. Each commit to `main` deploys
automatically, so review a change before pushing it. GitHub Actions are
disabled. No API key, server, database, or dependency build is needed for this
website.

The site is deployed at https://consequa-x.onrender.com. The original public
site remains at https://consequa-x.brawny-deer-5658.chatgpt.site, and the
sitemap still names it as the canonical host.

`website/dist/assets/demo-data.js` is generated from real Consequa-X 1.1.0 runs
of the synthetic demo: the recorded command output, four demo traces and the
`explain()` result for each. The inspector and terminal replay that data; they
run no action, verifier, model or payment in the browser. The demo window shows
`assets/sample-report.html`, the exact report those commands wrote, and the
offline report ZIP preserves the same bytes without hosting additions.

Only reviewed public website files are included. Private research records,
papers, model requests, credentials, and the research repository's history
are excluded. Website code uses the MIT license; local fonts retain their OFL
licenses under `website/dist/fonts/`.
