"""Generate the native gateway route manifest from the canonical Web contract."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def generate():
    routes=json.loads((ROOT/'web/native-web-contract.json').read_text())['required_routes']
    routes+=['GET system/capabilities','GET wizard/quick','POST wizard/quick','POST wizard/complete',
             'GET network/dns/config','POST network/dns/config','POST tools/diagnostic']
    target=ROOT/'integration/ram-web/native-routes.json'
    target.write_text(json.dumps(sorted(set(routes)),indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':generate()
