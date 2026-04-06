from bs4 import BeautifulSoup

with open("torvik_portal.html", "r", encoding="utf-8") as f:
    html = f.read()

soup = BeautifulSoup(html, "html.parser")
names = list(dict.fromkeys(a.get_text(strip=True) for a in soup.select("table a") if a.get_text(strip=True)))
print(",\n".join(f"'{n}'" for n in names))
