#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
caliper_report_plots.py — I-REC Benchmark Plot Suite

Parseia relatórios HTML do Hyperledger Caliper e gera 5 tipos de gráfico:

  1. Boxplots individuais por workload (distribuição completa)
  2. Grid de subplots  — boxplot por workload em painel separado
  3. Linha + banda CI  — média ± 1σ, melhor para comparar tendências
  4. Heatmap de medianas — saturação imediata (workload × TPS)
  5. Eficiência (%)    — throughput alcançado / TPS Configured

Uso:
  python caliper_report_plots.py --input "src/reports/**/*.html" --out src/plots
  python caliper_report_plots.py --input "src/reports/**/*.html" --out src/plots --export-csv --plot-3d
  python caliper_report_plots.py --csv caliper_round_metrics.csv --out src/plots
"""

from __future__ import annotations

import argparse
import glob
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from matplotlib.lines import Line2D
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401

# ── Paleta colorblind-safe (IBM Carbon + Okabe-Ito) ───────────────────────────
# Diferenciável em escala de cinza e para daltônicos
_DEFAULT_PALETTE = [
    "#648FFF",  # azul
    "#FFB000",  # âmbar
    "#785EF0",  # violeta
    "#FE6100",  # laranja
    "#DC267F",  # magenta
    "#009E73",  # verde
    "#56B4E9",  # azul céu
    "#CC79A7",  # rosa
]
_DEFAULT_MARKERS = ["o", "s", "^", "D", "v", "P", "X", "*"]

GRID_KW = dict(linestyle="--", linewidth=0.5, alpha=0.45)
BOX_PROPS = dict(
    patch_artist=True,
    medianprops=dict(linewidth=2.0, color="#111111"),
    whiskerprops=dict(linewidth=1.0),
    capprops=dict(linewidth=1.0),
    flierprops=dict(marker="o", markersize=3, linestyle="none", alpha=0.5),
)

plt.rcParams.update({
    "font.family":       "sans-serif",
    "axes.spines.top":   False,
    "axes.spines.right": False,
})


def _build_palette(workloads):
    """Mapeia workload → (cor, marcador) de forma determinística."""
    colors  = {}
    markers = {}
    for i, wl in enumerate(sorted(workloads)):
        colors[wl]  = _DEFAULT_PALETTE[i % len(_DEFAULT_PALETTE)]
        markers[wl] = _DEFAULT_MARKERS[i % len(_DEFAULT_MARKERS)]
    return colors, markers


# ── Parsing ───────────────────────────────────────────────────────────────────

def _safe_float(x) -> Optional[float]:
    try:
        return None if pd.isna(x) else float(x)
    except Exception:
        return None


def _tps_from_filename(path: Path) -> Optional[float]:
    m = re.search(r"_(\d+(?:\.\d+)?)TPS_", path.name, re.IGNORECASE)
    return float(m.group(1)) if m else None


def _norm_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    return df


@dataclass
class RoundRecord:
    source_file: Path
    workload_label: str
    configured_tps: Optional[float]
    send_rate_tps: Optional[float]
    throughput_tps: Optional[float]
    avg_latency_s: Optional[float]
    max_latency_s: Optional[float]
    min_latency_s: Optional[float]
    succ: Optional[int]
    fail: Optional[int]


def parse_html(path: Path) -> List[RoundRecord]:
    html = path.read_text(encoding="utf-8", errors="ignore")
    configured_tps = _tps_from_filename(path)
    try:
        tables = [_norm_cols(t) for t in pd.read_html(io.StringIO(html))]
    except Exception as e:
        print(f"  [WARN] {path.name}: {e}")
        return []

    records, seen = [], set()
    for t in tables:
        cols = set(t.columns)
        if not ({"Name", "Send Rate (TPS)", "Throughput (TPS)"} <= cols):
            continue
        avg_col = next((c for c in t.columns if re.fullmatch(r"Avg Latency \((s|ms)\)", c)), None)
        max_col = next((c for c in t.columns if re.fullmatch(r"Max Latency \((s|ms)\)", c)), None)
        min_col = next((c for c in t.columns if re.fullmatch(r"Min Latency \((s|ms)\)", c)), None)

        for _, row in t.iterrows():
            name = str(row.get("Name", "")).strip()
            if not name or name.lower() == "name":
                continue
            sr = _safe_float(row.get("Send Rate (TPS)"))
            if (name, sr) in seen:
                continue
            seen.add((name, sr))

            def get_lat(col):
                if col is None:
                    return None
                v = _safe_float(row.get(col))
                return v / 1000.0 if (v is not None and col.endswith("(ms)")) else v

            records.append(RoundRecord(
                source_file=path, workload_label=name,
                configured_tps=configured_tps, send_rate_tps=sr,
                throughput_tps=_safe_float(row.get("Throughput (TPS)")),
                avg_latency_s=get_lat(avg_col), max_latency_s=get_lat(max_col),
                min_latency_s=get_lat(min_col),
                succ=int(row["Succ"]) if "Succ" in row and pd.notna(row.get("Succ")) else None,
                fail=int(row["Fail"]) if "Fail" in row and pd.notna(row.get("Fail")) else None,
            ))
    return records


def to_df(records) -> pd.DataFrame:
    return pd.DataFrame([vars(r) for r in records]) if records else pd.DataFrame()


def _x_col(df: pd.DataFrame) -> str:
    return "configured_tps" if "configured_tps" in df and df["configured_tps"].notna().any() else "send_rate_tps"


def _color_boxes(bp, color, alpha=0.60):
    for patch in bp["boxes"]:
        patch.set_facecolor(color)
        patch.set_alpha(alpha)


# ═════════════════════════════════════════════════════════════════════════════
# PLOT 1 — Boxplots individuais por workload
# ═════════════════════════════════════════════════════════════════════════════
def plot_individual_boxplots(df: pd.DataFrame, outdir: Path, colors: dict) -> None:
    """Um arquivo PNG por workload × métrica, com strip plot sobreposto."""
    outdir.mkdir(parents=True, exist_ok=True)
    xc = _x_col(df)

    for label, g in df.groupby("workload_label"):
        color     = colors.get(label, _DEFAULT_PALETTE[0])
        tps_levels = sorted(g[xc].dropna().unique())
        positions  = list(range(1, len(tps_levels) + 1))
        xtick_lbls = [str(int(t)) if float(t).is_integer() else str(t) for t in tps_levels]

        for metric, ylabel, title_sfx in [
            ("avg_latency_s",  "Average Latency (s)", "Latency vs TPS"),
            ("throughput_tps", "Throughput (TPS)",   "Throughput vs TPS"),
        ]:
            data_per_level = []
            for tps in tps_levels:
                vals = g.loc[g[xc] == tps, metric].dropna().tolist()
                data_per_level.append(vals if vals else [np.nan])

            if not any(any(not np.isnan(v) for v in d) for d in data_per_level):
                continue

            fig, ax = plt.subplots(figsize=(max(7, len(tps_levels) * 2.0), 5))
            bp = ax.boxplot(data_per_level, positions=positions, widths=0.5, **BOX_PROPS)
            _color_boxes(bp, color)

            rng = np.random.default_rng(42)
            for pos, vals in zip(positions, data_per_level):
                rv = [v for v in vals if not np.isnan(v)]
                if rv:
                    jit = rng.uniform(-0.14, 0.14, len(rv))
                    ax.scatter([pos + j for j in jit], rv, color=color,
                               alpha=0.85, s=24, zorder=3,
                               edgecolors="white", linewidths=0.5)

            if metric == "throughput_tps":
                ax.plot(positions, tps_levels, linestyle="--", color="#AAAAAA",
                        linewidth=1.1, label="Ideal", zorder=1)
                ax.legend(fontsize=9)

            ax.set_xticks(positions)
            ax.set_xticklabels(xtick_lbls, fontsize=10)
            ax.set_xlabel("TPS Configured", fontsize=11)
            ax.set_ylabel(ylabel, fontsize=11)
            ax.set_title(f"{label} — {title_sfx}", fontsize=13, fontweight="bold")
            ax.grid(True, **GRID_KW, axis="y")

            # n= abaixo de cada caixa
            y0, y1 = ax.get_ylim()
            for pos, vals in zip(positions, data_per_level):
                n = sum(1 for v in vals if not np.isnan(v))
                ax.text(pos, y0 - (y1 - y0) * 0.07, f"n={n}",
                        ha="center", va="top", fontsize=7.5,
                        color="#666666", style="italic")
            ax.set_ylim(y0 - (y1 - y0) * 0.12, y1)

            n_total = sum(sum(1 for v in d if not np.isnan(v)) for d in data_per_level)
            fname   = f"{label}__{metric.replace('_tps','').replace('_s','')}.png"
            fig.tight_layout()
            fig.savefig(outdir / fname, dpi=300, bbox_inches="tight")
            plt.close(fig)
            print(f"  ✓ {fname}  ({len(tps_levels)} TPS levels, {n_total} runs)")


# ═════════════════════════════════════════════════════════════════════════════
# PLOT 2 — Grid de subplots (um painel por workload)
# Resolve o problema de amontoamento do comparativo original
# ═════════════════════════════════════════════════════════════════════════════
def plot_grid_boxplots(df: pd.DataFrame, outdir: Path, colors: dict,
                       metric="avg_latency_s", ylabel="Average Latency (s)",
                       title="Latency Distribution by Workload and TPS",
                       fname="grid_boxplots_latency.png") -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    workloads = sorted(df["workload_label"].unique())
    xc        = _x_col(df)
    all_tps   = sorted(df[xc].dropna().unique())

    ncols = min(4, len(workloads))
    nrows = int(np.ceil(len(workloads) / ncols))
    fig, axes = plt.subplots(nrows, ncols,
                             figsize=(ncols * 4.5, nrows * 3.8),
                             sharey=False, sharex=True)
    axes = np.array(axes).flatten()

    for wi, wl in enumerate(workloads):
        ax    = axes[wi]
        g     = df[df["workload_label"] == wl]
        color = colors.get(wl, _DEFAULT_PALETTE[wi % len(_DEFAULT_PALETTE)])

        data_per_level = []
        positions = list(range(1, len(all_tps) + 1))
        for tps in all_tps:
            vals = g.loc[g[xc] == tps, metric].dropna().tolist()
            data_per_level.append(vals if vals else [np.nan])

        bp = ax.boxplot(data_per_level, positions=positions, widths=0.55, **BOX_PROPS)
        _color_boxes(bp, color)

        rng = np.random.default_rng(99)
        for pos, vals in zip(positions, data_per_level):
            rv = [v for v in vals if not np.isnan(v)]
            if rv:
                jit = rng.uniform(-0.15, 0.15, len(rv))
                ax.scatter([pos + j for j in jit], rv, color=color,
                           alpha=0.85, s=16, zorder=3,
                           edgecolors="white", linewidths=0.4)

        # Título do subplot com identificador e nome curto
        short = wl.split("_", 1)[1] if "_" in wl else wl
        wid   = wl.split("_")[0]
        ax.set_title(f"{wid} — {short}", fontsize=9.5,
                     fontweight="bold", color=color, pad=4)
        ax.set_xticks(positions)
        ax.set_xticklabels([str(int(t)) for t in all_tps], fontsize=7.5, rotation=45)
        ax.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.1f"))
        ax.tick_params(axis="y", labelsize=8)
        ax.grid(True, **GRID_KW, axis="y")
        ax.set_facecolor("#F9F9F9")
        if wi % ncols == 0:
            ax.set_ylabel(ylabel, fontsize=9)

    for ax in axes[len(workloads):]:
        ax.set_visible(False)

    fig.suptitle(title, fontsize=14, fontweight="bold", y=1.01)
    fig.text(0.5, -0.01, "TPS Configured", ha="center", fontsize=11)
    fig.tight_layout()
    fig.savefig(outdir / fname, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {fname}")


# ═════════════════════════════════════════════════════════════════════════════
# PLOT 3 — Linha + banda de confiança (média ± 1σ)
# Melhor para comparar TENDÊNCIAS entre workloads
# ═════════════════════════════════════════════════════════════════════════════
def plot_line_ci(df: pd.DataFrame, outdir: Path, colors: dict, markers: dict,
                 metric="avg_latency_s", ylabel="Average Latency (s)",
                 title="Latency — Tendência por Workload (média ± 1σ)",
                 fname="line_ci_latency.png") -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    workloads = sorted(df["workload_label"].unique())
    xc        = _x_col(df)
    all_tps   = sorted(df[xc].dropna().unique())

    fig, ax = plt.subplots(figsize=(13, 6))
    handles = []

    for wl in workloads:
        g     = df[df["workload_label"] == wl]
        color = colors.get(wl, "#888888")
        mark  = markers.get(wl, "o")
        xs, means, stds = [], [], []

        for tps in all_tps:
            vals = g.loc[g[xc] == tps, metric].dropna().values
            if len(vals):
                xs.append(tps)
                means.append(np.mean(vals))
                stds.append(np.std(vals))

        if not xs:
            continue

        xs, mu, sd = np.array(xs), np.array(means), np.array(stds)
        ax.plot(xs, mu, color=color, marker=mark, markersize=7,
                linewidth=2.0, zorder=3)
        ax.fill_between(xs, mu - sd, mu + sd, color=color, alpha=0.14, zorder=2)
        handles.append(Line2D([0], [0], color=color, marker=mark,
                               markersize=8, linewidth=2, label=wl))

    ax.set_xlabel("TPS Configured", fontsize=12)
    ax.set_ylabel(ylabel, fontsize=12)
    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xticks(all_tps)
    ax.grid(True, **GRID_KW)
    ax.legend(handles=handles, fontsize=9, loc="best",
              framealpha=0.92, ncol=1, handlelength=2.2)
    fig.tight_layout()
    fig.savefig(outdir / fname, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {fname}")


# ═════════════════════════════════════════════════════════════════════════════
# PLOT 4 — Heatmap de medianas (workload × TPS)
# Visão imediata de saturação; células anotadas com valor
# ═════════════════════════════════════════════════════════════════════════════
def plot_heatmap(df: pd.DataFrame, outdir: Path,
                 metric="throughput_tps",
                 title="Throughput Mediano (TPS) — Heatmap",
                 fname="heatmap_throughput.png") -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    xc        = _x_col(df)
    workloads = sorted(df["workload_label"].unique())
    all_tps   = sorted(df[xc].dropna().unique())

    matrix = np.full((len(workloads), len(all_tps)), np.nan)
    for wi, wl in enumerate(workloads):
        g = df[df["workload_label"] == wl]
        for ti, tps in enumerate(all_tps):
            vals = g.loc[g[xc] == tps, metric].dropna().values
            if len(vals):
                matrix[wi, ti] = np.median(vals)

    fig, ax = plt.subplots(figsize=(max(10, len(all_tps) * 1.4),
                                    max(4, len(workloads) * 0.95)))
    cmap = "RdYlGn" if metric == "throughput_tps" else "RdYlGn_r"
    im = ax.imshow(matrix, aspect="auto", cmap=cmap, interpolation="nearest")

    vmin, vmax = np.nanmin(matrix), np.nanmax(matrix)
    for wi in range(len(workloads)):
        for ti in range(len(all_tps)):
            v = matrix[wi, ti]
            if not np.isnan(v):
                brightness = (v - vmin) / (vmax - vmin + 1e-9)
                txt_color  = "white" if brightness < 0.35 or brightness > 0.80 else "#1a1a1a"
                ax.text(ti, wi, f"{v:.1f}", ha="center", va="center",
                        fontsize=10, fontweight="bold", color=txt_color)

    ax.set_xticks(range(len(all_tps)))
    ax.set_xticklabels([str(int(t)) for t in all_tps], fontsize=11)
    ax.set_yticks(range(len(workloads)))
    ax.set_yticklabels(workloads, fontsize=10)
    ax.set_xlabel("TPS Configured", fontsize=12)

    cbar = fig.colorbar(im, ax=ax, pad=0.01, fraction=0.025)
    unit = "TPS" if metric == "throughput_tps" else "s"
    cbar.set_label(f"Median ({unit})", fontsize=10)
    ax.set_title(title, fontsize=14, fontweight="bold", pad=10)

    fig.tight_layout()
    fig.savefig(outdir / fname, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {fname}")


# ═════════════════════════════════════════════════════════════════════════════
# PLOT 5 — Eficiência de throughput (% do TPS ideal alcançado)
# Revela onde cada workload "quebra" independentemente da escala
# ═════════════════════════════════════════════════════════════════════════════
def plot_efficiency(df: pd.DataFrame, outdir: Path, colors: dict, markers: dict,
                    fname="throughput_efficiency.png") -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    xc        = _x_col(df)
    workloads = sorted(df["workload_label"].unique())
    all_tps   = sorted(df[xc].dropna().unique())

    fig, ax = plt.subplots(figsize=(13, 6))
    handles = []

    for wl in workloads:
        g     = df[df["workload_label"] == wl]
        color = colors.get(wl, "#888888")
        mark  = markers.get(wl, "o")
        xs, effs, eff_stds = [], [], []

        for tps in all_tps:
            vals = g.loc[g[xc] == tps, "throughput_tps"].dropna().values
            if len(vals):
                eff = (vals / tps) * 100
                xs.append(tps)
                effs.append(np.mean(eff))
                eff_stds.append(np.std(eff))

        if not xs:
            continue

        xs, mu, sd = np.array(xs), np.array(effs), np.array(eff_stds)
        ax.plot(xs, mu, color=color, marker=mark, markersize=7, linewidth=2.0, zorder=3)
        ax.fill_between(xs, np.clip(mu - sd, 0, 200), np.clip(mu + sd, 0, 200),
                        color=color, alpha=0.13, zorder=2)
        handles.append(Line2D([0], [0], color=color, marker=mark,
                               markersize=8, linewidth=2, label=wl))

    ax.axhline(100, linestyle="--", color="#333333", linewidth=1.3, zorder=1)
    ax.axhline(80,  linestyle=":",  color="#BBBBBB", linewidth=1.0, zorder=1)
    ax.text(all_tps[-1] + 0.3, 100.5, "100% pattern",  fontsize=8.5, color="#333333", va="bottom")
    ax.text(all_tps[-1] + 0.3,  80.5, "80% threshold",  fontsize=8.5, color="#BBBBBB", va="bottom")

    ax.set_xlabel("TPS Configured", fontsize=12)
    ax.set_ylabel("Throughput Achieved / TPS Configured (%)", fontsize=11)
    ax.set_title("Throughput Efficiency per Workload (Average)", fontsize=14, fontweight="bold")
    ax.set_xticks(all_tps)
    ax.set_ylim(0, 125)
    ax.yaxis.set_major_formatter(ticker.PercentFormatter(xmax=100, decimals=0))
    ax.grid(True, **GRID_KW)
    ax.legend(handles=handles, fontsize=9, loc="lower left",
              framealpha=0.92, ncol=2, handlelength=2.2)
    fig.tight_layout()
    fig.savefig(outdir / fname, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {fname}")


# ═════════════════════════════════════════════════════════════════════════════
# PLOT 6 — 3D bar (medianas, opcional)
# ═════════════════════════════════════════════════════════════════════════════
def plot_3d_bar(df: pd.DataFrame, outpath: Path, colors: dict,
                metric="avg_latency_s") -> None:
    xc        = _x_col(df)
    g         = df.dropna(subset=[xc, metric])
    workloads = sorted(g["workload_label"].unique())
    rates     = sorted(g[xc].unique())

    if len(workloads) < 2 or len(rates) < 2:
        print(f"  [WARN] 3D precisa ≥2 workloads e ≥2 TPS levels")
        return

    x_map = {s: i for i, s in enumerate(workloads)}
    y_map = {r: j for j, r in enumerate(rates)}
    agg   = g.groupby(["workload_label", xc])[metric].median().reset_index()
    xs    = agg["workload_label"].map(x_map).astype(float).to_numpy()
    ys    = agg[xc].map(y_map).astype(float).to_numpy()
    zs    = agg[metric].astype(float).to_numpy()

    fig = plt.figure(figsize=(13, 7))
    ax  = fig.add_subplot(111, projection="3d")
    bar_colors = [colors.get(agg.iloc[i]["workload_label"], "#888888") for i in range(len(agg))]
    ax.bar3d(xs, ys, 0.0, 0.6, 0.6, zs, color=bar_colors, shade=True, alpha=0.85)

    ax.set_xticks([x_map[s] + 0.3 for s in workloads])
    ax.set_xticklabels([w.split("_")[0] for w in workloads], rotation=15, ha="right", fontsize=8)
    ax.set_yticks([y_map[r] + 0.3 for r in rates])
    ax.set_yticklabels([str(int(r)) for r in rates], fontsize=8)
    ax.set_xlabel("Workload", labelpad=10, fontsize=10)
    ax.set_ylabel("TPS Configured", labelpad=10, fontsize=10)
    zlabel = "Median Latency (s)" if metric.endswith("_s") else "Throughput Mediano (TPS)"
    ax.set_zlabel(zlabel, labelpad=10, fontsize=10)
    ax.set_title(f"Visão 3D — {zlabel}", fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(outpath, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {outpath.name}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="I-REC Caliper Plot Suite — boxplots, heatmap, tendência e eficiência."
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", help='Glob de HTMLs, ex: "src/reports/**/*.html"')
    src.add_argument("--csv",   help="CSV gerado por execução anterior (--export-csv)")
    ap.add_argument("--out", default="src/plots", help="Pasta de saída (default: src/plots)")
    ap.add_argument("--workload", help="Filtra por prefixo de label, ex: W1")
    ap.add_argument("--export-csv",  action="store_true", help="Exporta CSV consolidado")
    ap.add_argument("--plot-3d",     action="store_true", help="Gera gráfico 3D")
    ap.add_argument("--metric",      default="avg_latency_s",
                    choices=["avg_latency_s", "max_latency_s", "throughput_tps"])
    ap.add_argument("--no-individual", action="store_true", help="Não gera boxplots individuais")
    args = ap.parse_args()

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    # ── Carrega dados ──────────────────────────────────────────────────────────
    if args.csv:
        df = pd.read_csv(args.csv)
        print(f"[INFO] CSV carregado: {len(df)} registros")
    else:
        paths = sorted(Path(p) for p in glob.glob(args.input, recursive=True))
        if not paths:
            raise SystemExit(f"[ERR] Nenhum arquivo encontrado: {args.input}")
        print(f"[INFO] {len(paths)} arquivo(s) HTML encontrado(s)")
        all_records: List[RoundRecord] = []
        for p in paths:
            recs = parse_html(p)
            print(f"  {'✓' if recs else '⚠'} {p.name} → {[(r.workload_label, r.configured_tps) for r in recs]}")
            all_records.extend(recs)
        if not all_records:
            raise SystemExit("[ERR] Nenhuma métrica extraída.")
        df = to_df(all_records)

    if args.workload:
        df = df[df["workload_label"].str.startswith(args.workload)]
        if df.empty:
            raise SystemExit(f"[ERR] Sem dados para '{args.workload}'")

    xc = _x_col(df)
    workloads = sorted(df["workload_label"].unique())
    print(f"\n[INFO] {len(df)} registros | {len(workloads)} workloads | "
          f"{df[xc].nunique()} TPS levels")
    print(f"[INFO] Workloads: {workloads}")
    print(f"[INFO] TPS: {sorted(df[xc].dropna().unique())}")

    colors, markers = _build_palette(workloads)

    if args.export_csv:
        p = outdir / "caliper_round_metrics.csv"
        df.to_csv(p, index=False)
        print(f"\n[INFO] CSV: {p}")

    # ── Gera os plots ──────────────────────────────────────────────────────────
    if not args.no_individual:
        print("\n[1] Boxplots individuais por workload...")
        plot_individual_boxplots(df, outdir, colors)

    print("\n[2] Grid de boxplots — Latency...")
    plot_grid_boxplots(df, outdir, colors,
                       metric="avg_latency_s", ylabel="Average Latency (s)",
                       title="Latency Distribution by Workload and TPS",
                       fname="grid_boxplots_latency.png")

    print("\n[3] Grid de boxplots — throughput...")
    plot_grid_boxplots(df, outdir, colors,
                       metric="throughput_tps", ylabel="Throughput (TPS)",
                       title="Throughput Distribution by Workload and TPS",
                       fname="grid_boxplots_throughput.png")

    print("\n[4] Linha + CI — Latency...")
    plot_line_ci(df, outdir, colors, markers,
                 metric="avg_latency_s", ylabel="Average Latency (s)",
                 title="Latency — Tendência por Workload (média ± 1σ)",
                 fname="line_ci_latency.png")

    print("\n[5] Linha + CI — throughput...")
    plot_line_ci(df, outdir, colors, markers,
                 metric="throughput_tps", ylabel="Throughput (TPS)",
                 title="Throughput — Tendência por Workload (média ± 1σ)",
                 fname="line_ci_throughput.png")

    print("\n[6] Heatmap — throughput...")
    plot_heatmap(df, outdir,
                 metric="throughput_tps",
                 title="Throughput Mediano (TPS) — Heatmap por Workload × TPS",
                 fname="heatmap_throughput.png")

    print("\n[7] Heatmap — Latency...")
    plot_heatmap(df, outdir,
                 metric="avg_latency_s",
                 title="Median Latency (s) — Heatmap por Workload × TPS",
                 fname="heatmap_latency.png")

    print("\n[8] Eficiência de throughput...")
    plot_efficiency(df, outdir, colors, markers)

    if args.plot_3d:
        print("\n[9] Gráfico 3D...")
        plot_3d_bar(df, outdir / f"3d_{args.metric}.png", colors, metric=args.metric)

    print(f"\n[OK] Plots em: {outdir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())