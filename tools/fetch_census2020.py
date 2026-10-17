"""Fetch NYC Planning's shoreline-clipped 2020 Census blocks from NYC Open Data."""
import json,urllib.parse,urllib.request
from pathlib import Path
RAW=Path(__file__).resolve().parents[1]/'data-raw/census2020'
BASE='https://data.cityofnewyork.us/resource/wmsu-5muw.json'
def get(url):
 for attempt in range(2):
  try:
   with urllib.request.urlopen(url,timeout=90) as response:return json.load(response)
  except Exception:
   if attempt:raise
RAW.mkdir(parents=True,exist_ok=True)
metadata=get('https://data.cityofnewyork.us/api/views/wmsu-5muw.json')
assert metadata['name']=='2020 Census Blocks'
count=int(get(BASE+'?'+urllib.parse.urlencode({'$select':'count(*)'}))[0]['count'])
rows=[]
for offset in range(0,count,5000):
 rows.extend(get(BASE+'?'+urllib.parse.urlencode({'$limit':5000,'$offset':offset,'$order':'geoid'})))
 print(len(rows),'/',count,flush=True)
assert len(rows)==count==len({r['geoid'] for r in rows})
(RAW/'metadata.json').write_text(json.dumps(metadata))
(RAW/'blocks.json').write_text(json.dumps(rows,separators=(',',':')))
