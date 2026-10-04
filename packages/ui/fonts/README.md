# Self-hosted fonts

Unmodified normal-style variable WOFF2 files from the official
`@fontsource-variable` npm packages, version **5.3.0**:

| Package | Subsets | App weights |
| --- | --- | --- |
| `@fontsource-variable/bricolage-grotesque` | Latin | 600–800 |
| `@fontsource-variable/geist` | Latin | 100–900 |
| `@fontsource-variable/geist-mono` | Latin | 400–500 |
| `@fontsource-variable/noto-sans-sinhala` | Latin, Sinhala | 400–600 |
| `@fontsource-variable/noto-sans-tamil` | Latin, Tamil | 400–600 |

Each family includes the package's original SIL Open Font License 1.1 as
`OFL.txt`. Source packages: https://github.com/fontsource/fontsource

Both apps load these files through `next/font/local`. Checking in the assets
keeps builds independent of font services and avoids adding runtime dependencies.
To update, download the matching npm package tarballs, copy the listed
`files/*-wght-normal.woff2` assets and `LICENSE`, and update this version record.
