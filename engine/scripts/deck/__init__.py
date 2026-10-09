"""Seeded generators for the standard deck; each returns {relative_path: benchmark_dict}."""

from . import calibration, coding, extraction, factuality, instructions, long_context, multilingual, reasoning, robustness, sdlc, summarization, tools

GENERATORS = [reasoning.build, instructions.build, extraction.build, tools.build, long_context.build, factuality.build, calibration.build, summarization.build, robustness.build, multilingual.build, sdlc.build, coding.build]
