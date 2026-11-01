# Cable Turf

[Cable Turf](https://cableturf.publicworks.nyc) is an independent
[publicworks.nyc](https://publicworks.nyc) map of home internet in New York City.
It colors each Census block by the cable company that serves it, draws the City's
cable franchise line on top, and shows where no other wired option is claimed.
A five-step story leads to the map, where tapping a block opens its figures.
On a keyboard, a neighborhood field and the arrow keys reach any block.

## Data sources

| Source | Used for |
| --- | --- |
| [FCC Broadband Data Collection](https://broadbandmap.fcc.gov/data-download), fixed availability files for New York, December 2025, updated 13 October 2026 | Companies and the buildings where each claims home service, by Census block |
| [NYC Planning 2020 Census Blocks](https://data.cityofnewyork.us/d/wmsu-5muw), `wmsu-5muw` | Block shapes, clipped to the shoreline |
| [OTI Cable Franchise Areas](https://data.cityofnewyork.us/d/n2h8-q6ag), `n2h8-q6ag`, published November 2016 | Each block's franchise holder, the franchise line, and the outline that trims map labels |
| [NYC Planning 2020 Neighborhood Tabulation Areas](https://data.cityofnewyork.us/d/9nt8-h7nd), `9nt8-h7nd` | The neighborhood named in each block's readout, and the neighborhood field |

Map labels come from OpenFreeMap's Positron tiles, with OpenStreetMap data.

## Method and limits

- Home service: only claims of residential or mixed service count. A building
  where every claim is business-only drops out of the counts. Spectrum's and
  Optimum's own fiber counts with their cable.
- Turf: a block belongs to the cable company that reports it. Where Spectrum
  and Optimum both report a block, it goes to one only if that company reports
  at least four times the other's buildings; otherwise both reach it.
- Other options: Verizon fiber and Astound cable or fiber count as another option.
  Wireless home internet from Verizon, T-Mobile and Starry is listed in the
  block readout and the CSV and never counts. Buildings with only the cable company are a
  floor, `locations − verizon_fiber − astound`, since the two claims can overlap.
- Map: each block takes its cable company's color. A hatch marks blocks where
  neither Verizon nor Astound claims any building. The Other options view
  shades each block by the share of its buildings that neither claims, from
  the same floor. Blocks with fewer than one
  building per two hectares, mostly parks, airports and cemeteries, are drawn
  as open land; they hold 0.2% of buildings and nearly a third of the land.
- Promise: Verizon's 2008 franchise promised Fios to every household by 30
  June 2014. It appears in the story's third step and the block readout, with
  sources on the Data page. `no_verizon_fiber` in the summary is the buildings
  less those Verizon claims fiber at; the promise counted households, so the
  two don't compare directly.
- Story: the third step names northern Harlem, NYC Planning's Harlem (North).
  `STORY_PLACE` in the pipeline sets it, and the summary's `story` entry holds
  its figures, which the page fills in. Each step's camera is in `STEPS` in
  `docs/js/map.js`.
- Franchise: each block takes the OTI franchise area that holds the mean of its
  largest ring. On single-company blocks, turf matches the franchise map at
  99.97% of buildings; most of the 233 exceptions are in Marble Hill.
- Units: an FCC location is a building, so a tower counts once, like a house.
  Counts are the companies' own claims of service within 10 business days.
- Limits: on a few mostly commercial blocks, Verizon claims home service and
  the cable company claims only business service, so the map shows no cable
  company there. The franchise map is from 2016. The map shows blocks, and
  buildings on one block can differ.

The [Data page](https://cableturf.publicworks.nyc/data.html) has the sources, steps
and limits.

## Updates

The pipeline runs by hand and has no schedule. It uses only the Python standard
library.

```sh
python3 pipeline/build.py
```

It reads `data-raw/` and writes `docs/data/`. Git ignores `data-raw/`; the
built files in `docs/data/` are published. The raw files are:

| Path | What | How to get it |
| --- | --- | --- |
| `data-raw/census2020/` | 2020 Census blocks | `python3 tools/fetch_census2020.py` |
| `data-raw/nyc/franchise-areas.geojson` | OTI's franchise areas | NYC Open Data, `n2h8-q6ag`, GeoJSON export |
| `data-raw/fcc/` | The FCC's availability files for New York: cable, fiber and licensed fixed wireless, as zips | [broadbandmap.fcc.gov/data-download](https://broadbandmap.fcc.gov/data-download): pick the period and New York, then download each technology under Fixed Broadband |

The pipeline reads the FCC's zips as they are and skips a CSV unzipped beside
its zip. It stops if the columns differ from the FCC's layout, if the files
mix reporting periods, or if cable, fiber or licensed fixed wireless is
missing, and it never runs without them. When a new period arrives, update the
reporting period on the Data and About pages and in this README.

To preview the site, which is all of `docs/` with no build step:

```sh
python3 tools/serve.py 8772 docs
```

Open http://localhost:8772. Stylesheet and script links carry a `?v=` tag.
Change it on every page that loads a file whenever that file changes.

## Tools

Data pipeline: Python, standard library only. Website: static HTML, CSS and
JavaScript, served from GitHub Pages, with MapLibre GL JS 4.7.1, kept in
`docs/vendor/`, and OpenFreeMap's Positron labels. The site uses no account
system or analytics. Claude was used in development.

## License and reuse

Code is [BSD 3-Clause licensed](LICENSE). Compiled data can be reused with
attribution; the source data retain their publishers' terms. Carry the FCC
reporting period when republishing a figure, and say it comes from the
companies' own claims. The downloads are on the Data page.
