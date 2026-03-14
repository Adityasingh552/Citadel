import requests

url = "https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.csv"
resp = requests.get(url, timeout=60)
lines = resp.text.split("\n")
for i in range(5):
    if i < len(lines):
        print(f"Line {i}:", repr(lines[i]))
