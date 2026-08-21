import shutil
import sqlite3
from pathlib import Path

src = Path.home() / "AppData/Local/Google/Chrome/User Data/Default/History"
tmp = Path.home() / "AppData/Local/Temp/chrome-history-copy"
shutil.copy2(src, tmp)
con = sqlite3.connect(tmp)
rows = con.execute(
    """
    SELECT datetime(last_visit_time/1000000-11644473600,'unixepoch','localtime') as t, url, title
    FROM urls
    WHERE url LIKE '%docs.qq.com%' OR title LIKE '%选课%' OR title LIKE '%江财%'
    ORDER BY last_visit_time DESC
    LIMIT 40
    """
).fetchall()
for t, url, title in rows:
    print(f"{t}\t{title}\t{url}")
