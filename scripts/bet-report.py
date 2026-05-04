#!/usr/bin/env python3
"""
NRFI Bet Report
Correlates ~/Downloads/All_Bets_Export.xls with nrfi-outcomes DynamoDB table.
Generates an HTML report and deploys it to s3://nrfi-tracker-app/bbr
accessible at https://app.nrfipro.com/bbr

Usage: python3 scripts/bet-report.py
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta

XLS_PATH = "~/Downloads/All_Bets_Export.xls"
DYNAMO_TABLE = "nrfi-outcomes"
REGION = "us-east-1"
S3_BUCKET = "nrfi-tracker-app"
S3_KEY = "bbr"
CF_DISTRIBUTION = "E1JFGP2WTX58XO"
PUBLIC_URL = "https://app.nrfipro.com/bbr"

NAME_MAP = {
    'angels': 'Angels', 'astros': 'Astros', 'athletics': 'Athletics',
    'blue jays': 'Blue Jays', 'braves': 'Braves', 'brewers': 'Brewers',
    'cardinals': 'Cardinals', 'cubs': 'Cubs', 'd-backs': 'D-backs',
    'diamondbacks': 'D-backs', 'dodgers': 'Dodgers', 'giants': 'Giants',
    'guardians': 'Guardians', 'mariners': 'Mariners', 'marlins': 'Marlins',
    'mets': 'Mets', 'nationals': 'Nationals', 'orioles': 'Orioles',
    'padres': 'Padres', 'phillies': 'Phillies', 'pirates': 'Pirates',
    'rangers': 'Rangers', 'rays': 'Rays', 'red sox': 'Red Sox',
    'reds': 'Reds', 'rockies': 'Rockies', 'royals': 'Royals',
    'tigers': 'Tigers', 'twins': 'Twins', 'white sox': 'White Sox',
    'yankees': 'Yankees',
}


def to_american(decimal_str):
    d = float(decimal_str)
    if d >= 2.0:
        return f"+{int(round((d - 1) * 100))}"
    else:
        return f"{int(round(-100 / (d - 1)))}"


def parse_xls(path):
    import os
    path = os.path.expanduser(path)
    with open(path, 'r') as f:
        content = f.read()
    rows = re.findall(r'<ss:Row>(.*?)</ss:Row>', content, re.DOTALL)

    def extract_cells(row):
        return re.findall(r'<ss:Data[^>]*>(.*?)</ss:Data>', row, re.DOTALL)

    headers = extract_cells(rows[0])
    bets = []
    for row in rows[1:]:
        cells = extract_cells(row)
        if cells:
            bets.append(dict(zip(headers, cells)))
    return bets


def parse_result_date(result_str):
    m = re.match(r'(\d+)\s+(\w+)\s+(\d{4})', result_str)
    if m:
        try:
            return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %b %Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def fetch_outcomes(dates):
    values = {f':d{i}': {'S': d} for i, d in enumerate(dates)}
    condition = ' OR '.join([f'#d = :d{i}' for i in range(len(dates))])
    cmd = [
        'aws', 'dynamodb', 'scan',
        '--table-name', DYNAMO_TABLE,
        '--region', REGION,
        '--filter-expression', condition,
        '--expression-attribute-names', '{"#d": "date"}',
        '--expression-attribute-values', json.dumps(values),
        '--projection-expression', 'gamePk, #d, homeTeam, awayTeam, predictedGrade, actualNRFI, totalRuns',
        '--output', 'json',
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error fetching DynamoDB: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    outcomes = []
    for item in data['Items']:
        nrfi_val = item.get('actualNRFI')
        actual = nrfi_val.get('BOOL') if nrfi_val is not None else None
        outcomes.append({
            'date': item.get('date', {}).get('S', ''),
            'home': item.get('homeTeam', {}).get('S', ''),
            'away': item.get('awayTeam', {}).get('S', ''),
            'grade': item.get('predictedGrade', {}).get('S', '?'),
            'actualNRFI': actual,
        })
    return outcomes


def find_outcome(bet_teams, game_date, is_open, outcomes):
    t1, t2 = bet_teams
    exact = [o for o in outcomes if o['date'] == game_date
             and t1 in (o['home'], o['away']) and t2 in (o['home'], o['away'])]
    if exact:
        return exact[0]
    if is_open:
        return None
    dt = datetime.strptime(game_date, '%Y-%m-%d')
    for delta in [-1, 1]:
        adj = (dt + timedelta(days=delta)).strftime('%Y-%m-%d')
        fuzzy = [o for o in outcomes if o['date'] == adj
                 and t1 in (o['home'], o['away']) and t2 in (o['home'], o['away'])]
        if fuzzy:
            return fuzzy[0]
    return None


def normalize_team(name):
    return NAME_MAP.get(name.lower().strip(), name.strip().title())


def build_rows(nrfi_bets, outcomes):
    """Process bets and return (rows, stats) where rows are dicts ready for rendering."""
    rows = []
    total_pl = 0.0
    total_wagered = 0.0
    open_count = 0
    open_wager = 0.0
    won_count = 0
    lost_count = 0

    for b in nrfi_bets:
        teams = [t.strip() for t in re.split(r' vs\.? ', b['Match'], flags=re.I)]
        t1 = normalize_team(teams[0]) if len(teams) > 0 else '?'
        t2 = normalize_team(teams[1]) if len(teams) > 1 else '?'

        game_date = parse_result_date(b.get('Result', ''))
        status = b.get('Status', '')
        is_open = status == 'Open'

        o = find_outcome((t1, t2), game_date or '', is_open, outcomes) if game_date else None
        grade = o['grade'] if o else '?'
        actual = o['actualNRFI'] if o else None

        odds_str = to_american(b.get('Price', '0'))
        wager = float(b.get('Wager', 0))
        winnings = float(b.get('Winnings', 0))

        if status == 'Won':
            pl = winnings; total_pl += pl; total_wagered += wager; won_count += 1
        elif status == 'Lost':
            pl = -wager; total_pl += pl; total_wagered += wager; lost_count += 1
        elif status == 'Cashed Out':
            pl = winnings; total_pl += pl; total_wagered += wager
        else:
            pl = None
            open_count += 1
            open_wager += wager

        date_label = datetime.strptime(game_date, '%Y-%m-%d').strftime('%-d %b').upper() if game_date else '?'

        rows.append({
            'date': date_label,
            'matchup': f"{t1} vs. {t2}",
            'grade': grade,
            'odds': odds_str,
            'status': status,
            'wager': wager,
            'pl': pl,
            'actual_nrfi': actual,
            'is_open': is_open,
        })

    roi = (total_pl / total_wagered * 100) if total_wagered else 0
    stats = {
        'record': f"{won_count}W / {lost_count}L",
        'wagered': f"${total_wagered:.2f}",
        'pl': total_pl,
        'roi': roi,
        'open_count': open_count,
        'open_wager': open_wager,
    }
    return rows, stats


def section_stats(rows):
    """Compute W/L/P&L/ROI for a subset of rows."""
    settled = [r for r in rows if not r['is_open']]
    won  = sum(1 for r in settled if r['status'] == 'Won')
    lost = sum(1 for r in settled if r['status'] == 'Lost')
    pl   = sum(r['pl'] for r in settled if r['pl'] is not None)
    wagered = sum(r['wager'] for r in settled)
    roi  = (pl / wagered * 100) if wagered else 0
    opens = [r for r in rows if r['is_open']]
    return {
        'record': f"{won}W / {lost}L",
        'pl': pl,
        'roi': roi,
        'wagered': wagered,
        'open_count': len(opens),
        'open_wager': sum(r['wager'] for r in opens),
    }


def summary_block_html(s, label, accent):
    pl_c   = '#00e5a0' if s['pl'] >= 0 else '#ff4d6d'
    pl_s   = f"+${s['pl']:.2f}" if s['pl'] >= 0 else f"-${abs(s['pl']):.2f}"
    roi_s  = f"+{s['roi']:.1f}%" if s['roi'] >= 0 else f"{s['roi']:.1f}%"
    open_s = f'<div class="summary-stat"><div class="summary-val" style="color:#f5c842">{s["open_count"]}</div><div class="summary-lbl">OPEN</div></div>' if s['open_count'] else ''
    return f"""
    <div class="summary-block">
      <div class="summary-block-label" style="color:{accent}">{label}</div>
      <div class="summary-block-stats">
        <div class="summary-stat"><div class="summary-val" style="color:#e0eaf4">{s['record']}</div><div class="summary-lbl">RECORD</div></div>
        <div class="summary-stat"><div class="summary-val" style="color:#e0eaf4">${s['wagered']:.2f}</div><div class="summary-lbl">WAGERED</div></div>
        <div class="summary-stat"><div class="summary-val" style="color:{pl_c}">{pl_s}</div><div class="summary-lbl">NET P&L</div></div>
        <div class="summary-stat"><div class="summary-val" style="color:{pl_c}">{roi_s}</div><div class="summary-lbl">ROI</div></div>
        {open_s}
      </div>
    </div>"""


def render_html(rows, stats, yrfi_rows=None, yrfi_stats=None):
    updated = datetime.now().strftime('%-d %b %Y, %-I:%M %p ET').upper()
    pl_color = '#00e5a0' if stats['pl'] >= 0 else '#ff4d6d'
    pl_str = f"+${stats['pl']:.2f}" if stats['pl'] >= 0 else f"-${abs(stats['pl']):.2f}"
    roi_str = f"+{stats['roi']:.1f}%" if stats['roi'] >= 0 else f"{stats['roi']:.1f}%"
    a_rows     = [r for r in rows if r['grade'] == 'A']
    other_rows = [r for r in rows if r['grade'] != 'A']

    def grade_class(g):
        return {'A': 'grade-A', 'B': 'grade-B', 'C': 'grade-C', 'D': 'grade-D'}.get(g, 'grade-unknown')

    def row_html(r, bet_type='nrfi'):
        open_class = ' open-row' if r['is_open'] else ''
        gc = grade_class(r['grade'])

        if r['actual_nrfi'] is True:
            if bet_type == 'yrfi':
                result_html = '<span class="result-yrfi">&#10007; NRFI</span>'
            else:
                result_html = '<span class="result-nrfi">&#10003; NRFI</span>'
        elif r['actual_nrfi'] is False:
            if bet_type == 'yrfi':
                result_html = '<span class="result-nrfi">&#10003; YRFI</span>'
            else:
                result_html = '<span class="result-yrfi">&#10007; YRFI</span>'
        else:
            result_html = '<span class="result-pending">PENDING</span>'

        status_class = {'Won': 'status-Won', 'Lost': 'status-Lost'}.get(r['status'], 'status-Open')
        status_label = r['status'].upper()

        if r['pl'] is None:
            pl_html = '<span class="pl-open">—</span>'
        elif r['pl'] >= 0:
            pl_html = f'<span class="pl-pos">+${r["pl"]:.2f}</span>'
        else:
            pl_html = f'<span class="pl-neg">-${abs(r["pl"]):.2f}</span>'

        return f"""
          <tr class="{open_class}">
            <td class="td-date">{r['date']}</td>
            <td class="td-matchup">{r['matchup']}</td>
            <td style="text-align:center"><span class="grade-pill {gc}">{r['grade']}</span></td>
            <td class="td-odds">{r['odds']}</td>
            <td style="text-align:center"><span class="status-pill {status_class}">{status_label}</span></td>
            <td class="td-wager">${r['wager']:.2f}</td>
            <td class="td-pl">{pl_html}</td>
            <td class="td-result">{result_html}</td>
          </tr>"""

    def subtotal_html(s):
        pl_c = '#00e5a0' if s['pl'] >= 0 else '#ff4d6d'
        pl_s = f"+${s['pl']:.2f}" if s['pl'] >= 0 else f"-${abs(s['pl']):.2f}"
        roi_s = f"+{s['roi']:.1f}%" if s['roi'] >= 0 else f"{s['roi']:.1f}%"
        open_s = f" &middot; {s['open_count']} open" if s['open_count'] else ""
        return f"""
          <tr class="subtotal-row">
            <td colspan="5" style="text-align:right">
              <span class="subtotal-record">{s['record']}{open_s}</span>
            </td>
            <td class="td-wager">${s['wagered']:.2f}</td>
            <td class="td-pl"><span style="font-family:'Space Mono',monospace;font-size:11px;font-weight:700;color:{pl_c}">{pl_s}</span></td>
            <td style="text-align:center"><span class="subtotal-roi" style="color:{pl_c}">{roi_s}</span></td>
          </tr>"""

    def section_html(section_rows, label, bet_type='nrfi'):
        return f"""
          <tr class="section-header">
            <td colspan="8">{label}</td>
          </tr>
          {''.join(row_html(r, bet_type) for r in section_rows)}
          {subtotal_html(section_stats(section_rows))}"""

    rows_html = section_html(a_rows, 'GRADE A')
    if other_rows:
        rows_html += section_html(other_rows, 'OTHER GRADES')

    pending_html = ''
    if stats['open_count']:
        pending_html = f'<span class="footer-pending">&#9679; {stats["open_count"]} BETS PENDING &middot; ${stats["open_wager"]:.2f} AT RISK</span>'

    # YRFI card
    yrfi_card_html = ''
    if yrfi_rows:
        ya_rows     = [r for r in yrfi_rows if r['grade'] == 'A']
        yother_rows = [r for r in yrfi_rows if r['grade'] != 'A']
        yrfi_rows_html = section_html(ya_rows, 'GRADE A', 'yrfi')
        if yother_rows:
            yrfi_rows_html += section_html(yother_rows, 'OTHER GRADES', 'yrfi')
        yrfi_pending_html = ''
        if yrfi_stats and yrfi_stats['open_count']:
            yrfi_pending_html = f'<span class="footer-pending">&#9679; {yrfi_stats["open_count"]} BETS PENDING &middot; ${yrfi_stats["open_wager"]:.2f} AT RISK</span>'
        yrfi_card_html = f"""
  <div class="card" style="margin-top:20px;border-top-color:#ff4d6d;">
    <div class="card-type-label" style="font-family:'Space Mono',monospace;font-size:8px;letter-spacing:2px;color:#ff4d6d;padding:8px 14px;background:#060f18;border-bottom:1px solid #1a2e42;">YRFI BETS &mdash; 1ST INNING OVER 0.5</div>
    <div class="summary-bar">
      {summary_block_html(section_stats(ya_rows), 'GRADE A', '#ff4d6d') if ya_rows else ''}
      {summary_block_html(section_stats(yother_rows), 'OTHER GRADES', '#4a6080') if yother_rows else ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>DATE</th>
            <th>MATCHUP</th>
            <th class="center">GR</th>
            <th class="right">ODDS</th>
            <th class="center">STATUS</th>
            <th class="right">WAGER</th>
            <th class="right">P&L</th>
            <th class="center">RESULT</th>
          </tr>
        </thead>
        <tbody>
          {yrfi_rows_html}
        </tbody>
      </table>
    </div>
    <div class="card-footer">
      <span class="footer-note">MLB &middot; 1ST INNING OVER 0.5 &middot; 2026 SEASON</span>
      {yrfi_pending_html}
    </div>
  </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Benny's Bet Report &mdash; NRFI Pro</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #060f18;
      font-family: 'DM Sans', sans-serif;
      min-height: 100vh;
      padding: 32px 16px 48px;
      color: #c8d8e8;
    }}

    .page {{ max-width: 720px; margin: 0 auto; }}

    /* ── Page header ── */
    .page-header {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 20px;
      gap: 12px;
      flex-wrap: wrap;
    }}
    .page-title {{
      font-family: 'Bebas Neue', sans-serif;
      font-size: 32px;
      letter-spacing: 4px;
      color: #e0eaf4;
      line-height: 1;
    }}
    .page-title span {{ color: #00e5a0; }}
    .page-meta {{
      font-family: 'Space Mono', monospace;
      font-size: 8px;
      color: #4a6080;
      letter-spacing: 1.5px;
      text-align: right;
    }}
    .page-meta a {{
      color: #4a6080;
      text-decoration: none;
    }}
    .page-meta a:hover {{ color: #00e5a0; }}

    /* ── Card ── */
    .card {{
      background: linear-gradient(145deg, #0d1f30, #0a1520);
      border: 1px solid #1a2e42;
      border-top: 3px solid #00e5a0;
      border-radius: 14px;
      overflow: hidden;
    }}

    /* ── Summary bar ── */
    .summary-bar {{
      border-bottom: 1px solid #0e1822;
      background: #060f18;
    }}
    .summary-block {{
      padding: 12px 14px 10px;
      border-bottom: 1px solid #1a2e42;
    }}
    .summary-block:last-child {{ border-bottom: none; }}
    .summary-block-label {{
      font-family: 'Space Mono', monospace;
      font-size: 8px;
      letter-spacing: 2px;
      margin-bottom: 8px;
    }}
    .summary-block-stats {{
      display: flex;
      gap: 0;
    }}
    .summary-stat {{
      flex: 1;
      text-align: center;
      padding: 0 8px;
      border-right: 1px solid #1a2e42;
    }}
    .summary-stat:last-child {{ border-right: none; }}
    .summary-val {{
      font-family: 'Bebas Neue', sans-serif;
      font-size: 20px;
      line-height: 1;
    }}
    .summary-lbl {{
      font-family: 'Space Mono', monospace;
      font-size: 7px;
      color: #4a6080;
      letter-spacing: 1.5px;
      margin-top: 3px;
    }}

    /* ── Table ── */
    .table-wrap {{ overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; min-width: 560px; }}

    thead th {{
      font-family: 'Space Mono', monospace;
      font-size: 8px;
      color: #4a6080;
      letter-spacing: 1.5px;
      text-align: left;
      padding: 10px 14px;
      background: #0a1520;
      border-bottom: 1px solid #1a2e42;
      white-space: nowrap;
    }}
    thead th.right {{ text-align: right; }}
    thead th.center {{ text-align: center; }}

    tbody tr {{ border-bottom: 1px solid #0a1825; }}
    tbody tr:last-child {{ border-bottom: none; }}
    tbody tr.open-row {{ opacity: .55; }}

    tbody td {{ padding: 10px 14px; vertical-align: middle; white-space: nowrap; }}

    .td-date {{
      font-family: 'Space Mono', monospace;
      font-size: 9px;
      color: #4a6080;
      letter-spacing: 1px;
    }}
    .td-matchup {{
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #c8d8e8;
    }}
    .grade-pill {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px; height: 26px;
      border-radius: 7px;
      font-family: 'Bebas Neue', sans-serif;
      font-size: 18px;
      line-height: 1;
    }}
    .grade-A {{ background: #00e5a015; color: #00e5a0; border: 1px solid #00e5a040; }}
    .grade-B {{ background: #4a9eff15; color: #4a9eff; border: 1px solid #4a9eff40; }}
    .grade-C {{ background: #f5c84215; color: #f5c842; border: 1px solid #f5c84240; }}
    .grade-D {{ background: #ff4d6d15; color: #ff4d6d; border: 1px solid #ff4d6d40; }}
    .grade-unknown {{ background: #1a2e4215; color: #4a6080; border: 1px solid #1a2e42; }}

    .td-odds {{
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      color: #8899aa;
      text-align: right;
    }}
    .status-pill {{
      display: inline-block;
      font-family: 'Space Mono', monospace;
      font-size: 8px;
      letter-spacing: 1px;
      padding: 3px 8px;
      border-radius: 20px;
    }}
    .status-Won  {{ background: #00e5a015; color: #00e5a0; border: 1px solid #00e5a040; }}
    .status-Lost {{ background: #ff4d6d15; color: #ff4d6d; border: 1px solid #ff4d6d40; }}
    .status-Open {{ background: #f5c84215; color: #f5c842; border: 1px solid #f5c84240; }}

    .td-wager {{
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      color: #8899aa;
      text-align: right;
    }}
    .td-pl {{ text-align: right; }}
    .pl-pos {{ font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #00e5a0; }}
    .pl-neg {{ font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #ff4d6d; }}
    .pl-open {{ font-family: 'Space Mono', monospace; font-size: 11px; color: #2a4060; }}

    .td-result {{ text-align: center; }}
    .result-nrfi {{
      font-family: 'Space Mono', monospace; font-size: 9px;
      color: #00e5a0; letter-spacing: 1px;
    }}
    .result-yrfi {{
      font-family: 'Space Mono', monospace; font-size: 9px;
      color: #ff4d6d; letter-spacing: 1px;
    }}
    .result-pending {{
      font-family: 'Space Mono', monospace; font-size: 9px;
      color: #2a4060; letter-spacing: 1px;
    }}

    /* ── Footer ── */
    .card-footer {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-top: 1px solid #1a2e42;
      background: #060f18;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .footer-note {{
      font-family: 'Space Mono', monospace;
      font-size: 8px;
      color: #2a4060;
      letter-spacing: 1px;
    }}
    .footer-pending {{
      font-family: 'Space Mono', monospace;
      font-size: 9px;
      color: #f5c842;
      letter-spacing: 1px;
    }}

    /* ── Section headers & subtotals ── */
    tr.section-header td {{
      font-family: 'Space Mono', monospace;
      font-size: 8px;
      letter-spacing: 2px;
      color: #00e5a0;
      background: #060f18;
      padding: 8px 14px;
      border-top: 1px solid #1a2e42;
      border-bottom: 1px solid #1a2e42;
    }}
    tr.section-header:first-child td {{ border-top: none; }}
    tr.subtotal-row td {{
      background: #0a1825;
      padding: 8px 14px;
      border-top: 1px solid #1a2e42;
    }}
    .subtotal-record {{
      font-family: 'Space Mono', monospace;
      font-size: 9px;
      color: #4a6080;
      letter-spacing: 1px;
    }}
    .subtotal-roi {{
      font-family: 'Space Mono', monospace;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 1px;
    }}

    @media (max-width: 480px) {{
      .summary-lbl {{ font-size: 6px; letter-spacing: 0.5px; }}
      .summary-val {{ font-size: 18px; }}
      .page-title {{ font-size: 24px; }}
    }}
  </style>
</head>
<body>
<div class="page">

  <div class="page-header">
    <div class="page-title">BENNY'S <span>BET REPORT</span></div>
    <div class="page-meta">
      UPDATED {updated}<br>
      <a href="https://app.nrfipro.com">app.nrfipro.com</a>
    </div>
  </div>

  <div class="card">
    <div class="card-type-label" style="font-family:'Space Mono',monospace;font-size:8px;letter-spacing:2px;color:#00e5a0;padding:8px 14px;background:#060f18;border-bottom:1px solid #1a2e42;">NRFI BETS &mdash; 1ST INNING UNDER 0.5</div>
    <div class="summary-bar">
      {summary_block_html(section_stats(a_rows), 'GRADE A', '#00e5a0')}
      {summary_block_html(section_stats(other_rows), 'OTHER GRADES', '#4a6080') if other_rows else ''}
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>DATE</th>
            <th>MATCHUP</th>
            <th class="center">GR</th>
            <th class="right">ODDS</th>
            <th class="center">STATUS</th>
            <th class="right">WAGER</th>
            <th class="right">P&L</th>
            <th class="center">RESULT</th>
          </tr>
        </thead>
        <tbody>
          {rows_html}
        </tbody>
      </table>
    </div>

    <div class="card-footer">
      <span class="footer-note">MLB &middot; 1ST INNING UNDER 0.5 &middot; 2026 SEASON</span>
      {pending_html}
    </div>
  </div>

  {yrfi_card_html}

</div>
</body>
</html>"""


def deploy_html(html):
    import tempfile, os
    with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as f:
        f.write(html)
        tmp = f.name
    try:
        result = subprocess.run([
            'aws', 's3', 'cp', tmp,
            f's3://{S3_BUCKET}/{S3_KEY}',
            '--content-type', 'text/html',
            '--cache-control', 'no-cache',
            '--region', REGION,
        ], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"S3 upload failed: {result.stderr}", file=sys.stderr)
            return False

        result = subprocess.run([
            'aws', 'cloudfront', 'create-invalidation',
            '--distribution-id', CF_DISTRIBUTION,
            '--paths', f'/{S3_KEY}',
            '--output', 'json',
        ], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"CloudFront invalidation failed: {result.stderr}", file=sys.stderr)
            return False

        return True
    finally:
        os.unlink(tmp)


def main():
    print("Parsing bet file...", file=sys.stderr)
    all_bets = parse_xls(XLS_PATH)

    nrfi_bets = [b for b in all_bets
                 if b.get('League') == 'MLB'
                 and b.get('Bet Type') == '1st Inning Total Runs'
                 and 'Under 0.5' in b.get('Market', '')]

    yrfi_bets = [b for b in all_bets
                 if b.get('League') == 'MLB'
                 and b.get('Bet Type') == '1st Inning Total Runs'
                 and 'Over 0.5' in b.get('Market', '')]

    if not nrfi_bets and not yrfi_bets:
        print("No MLB 1st inning bets found.")
        return

    game_dates = set()
    for b in nrfi_bets + yrfi_bets:
        date_str = parse_result_date(b.get('Result', ''))
        if date_str:
            dt = datetime.strptime(date_str, '%Y-%m-%d')
            for delta in range(-1, 2):
                game_dates.add((dt + timedelta(days=delta)).strftime('%Y-%m-%d'))

    print(f"Fetching outcomes for {len(game_dates)} dates from DynamoDB...", file=sys.stderr)
    outcomes = fetch_outcomes(sorted(game_dates))

    rows,      stats      = build_rows(nrfi_bets, outcomes)
    yrfi_rows, yrfi_stats = build_rows(yrfi_bets, outcomes) if yrfi_bets else ([], None)

    # ── Terminal output ──
    def print_rows(section_rows):
        for r in section_rows:
            if r['actual_nrfi'] is True:   result_str = 'NRFI ✓'
            elif r['actual_nrfi'] is False: result_str = 'YRFI ✗'
            else:                           result_str = 'Pending'
            pl_str = f"+${r['pl']:.2f}" if r['pl'] and r['pl'] > 0 else (f"-${abs(r['pl']):.2f}" if r['pl'] and r['pl'] < 0 else 'Open')
            print(f"{r['date']:<8} {r['matchup']:<30} {r['grade']:<4} {r['odds']:<6} {r['status']:<8} ${r['wager']:.2f}  {pl_str:<9} {result_str}")

    def print_subtotal(section_rows):
        s = section_stats(section_rows)
        pl_str  = f"+${s['pl']:.2f}" if s['pl'] >= 0 else f"-${abs(s['pl']):.2f}"
        roi_str = f"+{s['roi']:.1f}%" if s['roi'] >= 0 else f"{s['roi']:.1f}%"
        open_s  = f"  |  Open: {s['open_count']} (${s['open_wager']:.2f})" if s['open_count'] else ""
        print(f"  {s['record']}  |  Wagered: ${s['wagered']:.2f}  |  P&L: {pl_str}  |  ROI: {roi_str}{open_s}")

    hdr = f"{'Date':<8} {'Matchup':<30} {'Gr':<4} {'Odds':<6} {'Status':<8} {'Wager':<7} {'P&L':<9} {'Result'}"
    div = '─' * 88

    a_rows     = [r for r in rows if r['grade'] == 'A']
    other_rows = [r for r in rows if r['grade'] != 'A']

    print()
    print("── NRFI BETS (Under 0.5) " + '─' * 64)
    print(hdr)
    print(div)
    if a_rows:
        print("  GRADE A")
        print(div)
        print_rows(a_rows)
        print(div)
        print_subtotal(a_rows)
    if other_rows:
        print()
        print("  OTHER GRADES")
        print(div)
        print_rows(other_rows)
        print(div)
        print_subtotal(other_rows)

    print()
    print(div)
    pl_str  = f"+${stats['pl']:.2f}" if stats['pl'] >= 0 else f"-${abs(stats['pl']):.2f}"
    roi_str = f"+{stats['roi']:.1f}%" if stats['roi'] >= 0 else f"{stats['roi']:.1f}%"
    print(f"NRFI TOTAL  {stats['record']}  |  Wagered: {stats['wagered']}  |  Net P&L: {pl_str}  |  ROI: {roi_str}")
    if stats['open_count']:
        print(f"Open:  {stats['open_count']} bets pending (${stats['open_wager']:.2f} at risk)")

    if yrfi_rows:
        ya_rows     = [r for r in yrfi_rows if r['grade'] == 'A']
        yother_rows = [r for r in yrfi_rows if r['grade'] != 'A']
        print()
        print("── YRFI BETS (Over 0.5) " + '─' * 64)
        print(hdr)
        print(div)
        if ya_rows:
            print("  GRADE A")
            print(div)
            print_rows(ya_rows)
            print(div)
            print_subtotal(ya_rows)
        if yother_rows:
            print()
            print("  OTHER GRADES")
            print(div)
            print_rows(yother_rows)
            print(div)
            print_subtotal(yother_rows)
        print()
        print(div)
        ypl_str  = f"+${yrfi_stats['pl']:.2f}" if yrfi_stats['pl'] >= 0 else f"-${abs(yrfi_stats['pl']):.2f}"
        yroi_str = f"+{yrfi_stats['roi']:.1f}%" if yrfi_stats['roi'] >= 0 else f"{yrfi_stats['roi']:.1f}%"
        print(f"YRFI TOTAL  {yrfi_stats['record']}  |  Wagered: {yrfi_stats['wagered']}  |  Net P&L: {ypl_str}  |  ROI: {yroi_str}")
        if yrfi_stats['open_count']:
            print(f"Open:  {yrfi_stats['open_count']} bets pending (${yrfi_stats['open_wager']:.2f} at risk)")

    # ── Deploy HTML ──
    print(f"\nDeploying report to S3...", file=sys.stderr)
    html = render_html(rows, stats, yrfi_rows or None, yrfi_stats)
    if deploy_html(html):
        print(f"Published: {PUBLIC_URL}", file=sys.stderr)
    else:
        print("Deploy failed — report not published.", file=sys.stderr)


if __name__ == '__main__':
    main()
