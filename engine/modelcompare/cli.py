from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

import typer
from dotenv import load_dotenv

from modelcompare import db
from modelcompare.bench_loader import resolve_benchmarks
from modelcompare.html_report import render_html
from modelcompare.report import build_report, latest_runs
from modelcompare.runner import benchmarks_needing_judge, estimate_cost, run_benchmark
from modelcompare.schema import load_targets

app = typer.Typer(help="Benchmark and compare LLMs on your own tasks.", no_args_is_help=True)

TargetsFile = typer.Option(Path("targets.yaml"), "--targets-file", "-f", help="YAML file defining targets.")


def _pick(targets_file: Path, names: list[str]):
    all_targets = load_targets(targets_file)
    missing = [n for n in names if n not in all_targets]
    if missing:
        raise typer.BadParameter(f"unknown targets {missing}; defined: {sorted(all_targets)}")
    return all_targets, [all_targets[n] for n in names]


@app.command("list")
def list_benchmarks(spec: list[str] = typer.Argument(None, help="Defaults to 'standard' and 'custom'.")):
    """List benchmarks with their dimension and case counts."""
    for b in resolve_benchmarks(spec or ["standard", "custom"]):
        typer.echo(f"{b.name:<32} {b.dimension:<24} {len(b.cases):>4} cases  x{b.repeats}  {b.fingerprint}")


@app.command()
def run(
    target: list[str] = typer.Option(..., "--target", "-t", help="Target name(s) from the targets file."),
    bench: list[str] = typer.Option(["standard"], "--bench", "-b", help="standard | custom | <dimension> | dir | file.yaml"),
    judge: Optional[str] = typer.Option(None, "--judge", "-j", help="Target used by llm_judge scorers."),
    repeats: Optional[int] = typer.Option(None, help="Override benchmark repeat count."),
    budget: Optional[float] = typer.Option(None, help="Stop a run once it spends this many USD."),
    concurrency: int = typer.Option(8),
    no_cache: bool = typer.Option(False, "--no-cache"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip the cost confirmation."),
    targets_file: Path = TargetsFile,
):
    """Run benchmarks against one or more targets."""
    load_dotenv()
    all_targets, cfgs = _pick(targets_file, target)
    judge_cfg = all_targets.get(judge) if judge else None
    if judge and not judge_cfg:
        raise typer.BadParameter(f"unknown judge target {judge}")
    benches = resolve_benchmarks(bench)
    if repeats:
        benches = [b.model_copy(update={"repeats": repeats}) for b in benches]
    needs_judge = benchmarks_needing_judge(benches)
    if needs_judge and not judge_cfg:
        raise typer.BadParameter(f"--judge is required for {needs_judge}")

    est = sum(estimate_cost(c, b) for c in cfgs for b in benches)
    typer.echo(f"{len(cfgs)} targets x {len(benches)} benchmarks, estimated ≤ ${est:.2f} (excl. judge, before cache).")
    if not yes and est > 0 and not typer.confirm("Proceed?"):
        raise typer.Abort()

    async def go():
        for cfg in cfgs:
            for b in benches:
                out = await run_benchmark(cfg, b, judge_cfg, concurrency, budget, not no_cache)
                passed = sum(r.passed for r in out.results)
                typer.echo(f"  run {out.run_id:>4}  {cfg.name:<20} {b.name:<30} {passed}/{len(out.results)} passed  ${out.cost_usd:.4f}  [{out.status}]")

    asyncio.run(go())


@app.command()
def compare(
    target: list[str] = typer.Option(..., "--target", "-t", help="Targets to compare (latest run per benchmark)."),
    baseline: Optional[str] = typer.Option(None, help="Incumbent model; defaults to the first --target."),
    bench: Optional[list[str]] = typer.Option(None, "--bench", "-b", help="Restrict to these benchmark names."),
    min_quality: float = typer.Option(0.7, help="Quality bar for 'best value' / 'fastest acceptable'."),
    profiles: Optional[Path] = typer.Option(None, help="Custom profiles.yaml."),
    out: Path = typer.Option(Path("reports/report.html"), "--out", "-o"),
):
    """Compare targets and write an HTML + JSON report."""
    with db.session() as s:
        runs = latest_runs(s, target, bench)
        found = {r.target_name for r in runs}
        if missing := set(target) - found:
            raise typer.BadParameter(f"no completed runs for {sorted(missing)}; run `modelcompare run` first")
        rep = build_report(s, runs, baseline=baseline or target[0], min_quality=min_quality, profiles_path=profiles)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_html(rep))
    out.with_suffix(".json").write_text(json.dumps(rep, indent=2, default=str))
    for hd in rep["headline"]:
        typer.echo(f"{hd['candidate']} vs {hd['baseline']}: {hd['overall'].upper()}  better={hd['better_on']} worse={hd['worse_on']}")
    for r in rep["recommendations"]:
        typer.echo(f"  {r['dimension']:<24} → {r['recommended']}  ({r['summary']})")
    for w in rep["warnings"]:
        typer.echo(f"  ! {w}")
    typer.echo(f"Report: {out.resolve()}")


@app.command()
def runs():
    """List stored runs."""
    with db.session() as s:
        for r in db.list_runs(s):
            typer.echo(f"{r.id:>4}  {r.started_at:%Y-%m-%d %H:%M}  {r.target_name:<20} {r.benchmark_name:<30} {r.status}")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000):
    """Start the HTTP API used by the web dashboard."""
    import uvicorn

    load_dotenv()
    uvicorn.run("modelcompare.api:api", host=host, port=port)


if __name__ == "__main__":
    app()
